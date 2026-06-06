'use strict'

/**
 * Геокодирование через 2GIS (Playwright)
 * Стратегия: парсим stat=BASE64 из href ссылок результатов поиска
 * В stat зашиты geoPosition.lon/lat — координаты без клика
 *
 * Запуск: node scripts/geocode-2gis-v2.js
 */

const { chromium } = require('../dashboard/node_modules/@playwright/test')
const XLSX = require('../dashboard/node_modules/xlsx')
const fs = require('fs')
const path = require('path')

const EXCEL_FILE  = path.join(__dirname, '../Данные/Тепловая карта.xlsx')
const OUTPUT_JSON = path.join(__dirname, '../dashboard/data/geocoded-addresses.json')
const OUTPUT_LOG  = path.join(__dirname, '../Данные/coordinats logs.txt')

const CONCURRENCY  = 4       // параллельных вкладок
const NAV_TIMEOUT  = 15000   // мс на загрузку страницы
const WAIT_RESULTS = 2500    // мс ждём рендер результатов поиска

const BBOX = { minLat: 43.05, maxLat: 43.55, minLng: 76.60, maxLng: 77.40 }

function inAlmaty(lat, lng) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng
}

// ——— Очистка адреса: убираем кв/этаж/офис/подъезд ———
function cleanAddress(addr) {
  return addr.trim()
    .replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
    .replace(/,\s*квартира\s+\d+[а-яА-Я]?\s*$/i, '')
    .replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
    .replace(/,\s*офис\s*[\w]*\s*$/i, '')
    .replace(/,\s*подъезд\s+\d+\s*$/i, '')
    .replace(/,\s*под\.\s*\d+\s*$/i, '')
    .replace(/,\s*пом\.\s*[\w]+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normKey(addr) {
  return cleanAddress(addr).toLowerCase().replace(/\s+/g, ' ').trim()
}

// ——— Декодируем stat=BASE64 из href 2GIS ———
function extractCoordsFromStat(href) {
  try {
    const m = href.match(/[?&]stat=([A-Za-z0-9+/=_%]+)/)
    if (!m) return null
    const raw = decodeURIComponent(m[1])
    const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    const pos = json?.placeItem?.geoPosition
    if (pos && inAlmaty(parseFloat(pos.lat), parseFloat(pos.lon))) {
      return { lat: parseFloat(pos.lat), lng: parseFloat(pos.lon) }
    }
  } catch {}
  return null
}

// ——— Геокодирование одного адреса ———
async function geocodeOnPage(page, address) {
  const clean = cleanAddress(address)
  const searchUrl = `https://2gis.kz/almaty/search/${encodeURIComponent(clean)}`

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    await page.waitForTimeout(WAIT_RESULTS)
  } catch {
    // Таймаут навигации — всё равно пробуем читать страницу
  }

  // Стратегия 1: читаем stat=BASE64 из ссылок результатов (без клика)
  try {
    const hrefs = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/almaty/geo/"]')
      return Array.from(links).map(a => a.getAttribute('href')).filter(Boolean)
    })

    for (const href of hrefs) {
      const coords = extractCoordsFromStat(href)
      if (coords) return coords
    }
  } catch {}

  // Стратегия 2: кнопка с координатами "_yo9a24n" (показывается после клика на результат)
  try {
    // Кликаем первую ссылку geo
    await page.click('a[href*="/almaty/geo/"]', { timeout: 2000 })
    await page.waitForTimeout(1500)
    const coordText = await page.textContent('button._yo9a24n, [class*="yo9a24n"]', { timeout: 2000 })
    if (coordText) {
      const m = coordText.match(/([\d.]+),\s*([\d.]+)/)
      if (m) {
        const lat = parseFloat(m[1])
        const lng = parseFloat(m[2])
        if (inAlmaty(lat, lng)) return { lat, lng }
      }
    }
  } catch {}

  // Стратегия 3: из URL (после клика URL содержит /LNG,LAT/)
  try {
    const url = page.url()
    // Формат: /geo/ID/76.898498,43.249174/
    const m = url.match(/\/geo\/\d+\/([\d.]+),([\d.]+)/)
    if (m) {
      const lng = parseFloat(m[1])
      const lat = parseFloat(m[2])
      if (inAlmaty(lat, lng)) return { lat, lng }
    }
    // Формат ?m=LNG,LAT/ZOOM
    const m2 = url.match(/[?&]m=([\d.]+)[%2C,]+([\d.]+)/i)
    if (m2) {
      const lng = parseFloat(m2[1])
      const lat = parseFloat(m2[2])
      const isDefault = Math.abs(lng - 76.889709) < 0.005 && Math.abs(lat - 43.238293) < 0.005
      if (inAlmaty(lat, lng) && !isDefault) return { lat, lng }
    }
  } catch {}

  return null
}

// ——— Парсинг Excel ———
function parseExcel() {
  const wb = XLSX.readFile(EXCEL_FILE)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  let hi = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (raw[i].some(c => String(c).trim() === 'Адрес')) { hi = i; break }
  }
  if (hi === -1) hi = 1

  const hdr = raw[hi].map(h => String(h).trim())
  const ai = hdr.findIndex(h => h === 'Адрес')
  const oi = hdr.findIndex(h => h.includes('заказ'))

  const records = []
  for (let i = hi + 1; i < raw.length; i++) {
    const row = raw[i]
    const addr = ai >= 0 ? String(row[ai] || '').trim() : ''
    if (!addr || addr === 'Адрес') continue
    records.push({ address: addr, orders: oi >= 0 ? (parseInt(row[oi]) || 1) : 1 })
  }
  return records
}

// ——— Сохранение JSON ———
function saveJSON(addrMap, cache) {
  const output = []
  for (const item of addrMap.values()) {
    const c = cache[item.normalized]
    if (!c) continue
    output.push({
      address: item.address,
      normalized: item.normalized,
      orders: item.orders,
      lat: parseFloat(c.lat.toFixed(7)),
      lng: parseFloat(c.lng.toFixed(7))
    })
  }
  output.sort((a, b) => b.orders - a.orders)
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8')
  return output.length
}

// ——— Воркер ———
async function worker(browser, items, cache, addrMap, stats) {
  const page = await browser.newPage()

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
  })

  // Блокируем картинки и шрифты для скорости
  await page.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4,mp3}', r => r.abort())

  for (const item of items) {
    if (cache[item.normalized]) {
      stats.cached++
      stats.processed++
      printProgress(stats)
      continue
    }

    const coords = await geocodeOnPage(page, item.address)

    if (coords) {
      cache[item.normalized] = coords
      stats.done++
      // Пишем в лог файл
      const logLine = `[OK] ${item.address} → ${coords.lat}, ${coords.lng}\n`
      fs.appendFileSync(OUTPUT_LOG, logLine, 'utf8')
    } else {
      stats.failed++
      const logLine = `[НЕ НАЙДЕНО] ${item.address}\n`
      fs.appendFileSync(OUTPUT_LOG, logLine, 'utf8')
    }

    stats.processed++
    printProgress(stats)

    // Сохраняем JSON каждые 30 найденных
    if (stats.done > 0 && stats.done % 30 === 0) {
      saveJSON(addrMap, cache)
    }
  }

  await page.close()
}

function printProgress(stats) {
  const pct = Math.round(stats.processed / stats.total * 100)
  process.stdout.write(
    `\r  ${stats.processed}/${stats.total} (${pct}%) | найдено: ${stats.done} | не найдено: ${stats.failed} | кэш: ${stats.cached}   `
  )
}

// ——— Main ———
async function main() {
  console.log('Читаю Excel...')
  const records = parseExcel()
  console.log(`Записей: ${records.length}`)

  const addrMap = new Map()
  for (const r of records) {
    const key = normKey(r.address)
    if (!key || key.length < 5) continue
    if (!addrMap.has(key)) addrMap.set(key, { address: r.address, normalized: key, orders: 0 })
    addrMap.get(key).orders += r.orders
  }
  const uniqueList = [...addrMap.values()]
  console.log(`Уникальных адресов: ${uniqueList.length}`)

  // Загрузка кэша
  const cache = {}
  if (fs.existsSync(OUTPUT_JSON)) {
    try {
      const ex = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8'))
      for (const r of ex) {
        if (r.normalized && r.lat && r.lng) cache[r.normalized] = { lat: r.lat, lng: r.lng }
      }
      console.log(`Кэш: ${Object.keys(cache).length} адресов`)
    } catch {}
  }

  const toProcess = uniqueList.filter(u => !cache[u.normalized])
  console.log(`Осталось геокодировать: ${toProcess.length}`)

  if (toProcess.length === 0) {
    const n = saveJSON(addrMap, cache)
    console.log(`✓ Все в кэше. ${n} адресов.`)
    return
  }

  // Инициализируем лог
  const startLine = `\n=== Запуск ${new Date().toLocaleString('ru-RU')} | Осталось: ${toProcess.length} адресов ===\n`
  fs.appendFileSync(OUTPUT_LOG, startLine, 'utf8')
  console.log(`\nЛог: ${OUTPUT_LOG}`)
  console.log('Открываю браузер...\n')

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  })

  // Делим на CONCURRENCY частей
  const chunks = Array.from({ length: CONCURRENCY }, (_, i) =>
    toProcess.filter((_, idx) => idx % CONCURRENCY === i)
  )

  const stats = {
    done: 0, failed: 0,
    cached: Object.keys(cache).length,
    processed: 0, total: uniqueList.length
  }

  // Периодическое сохранение JSON
  const saveInterval = setInterval(() => {
    const n = saveJSON(addrMap, cache)
    process.stdout.write(`\n  [JSON сохранён: ${n} адресов]\n`)
  }, 30000)

  try {
    await Promise.all(chunks.map(chunk => worker(browser, chunk, cache, addrMap, stats)))
  } finally {
    clearInterval(saveInterval)
    await browser.close()
  }

  console.log('\n')
  const total = saveJSON(addrMap, cache)
  fs.appendFileSync(OUTPUT_LOG, `\n=== Готово: найдено ${stats.done}, не найдено ${stats.failed} ===\n`, 'utf8')
  console.log(`✓ Готово! JSON: ${total} адресов`)
  console.log(`  Найдено: ${stats.done} | Не найдено: ${stats.failed}`)
}

process.on('SIGINT', () => {
  console.log('\nПрерывание. Данные сохранены.')
  process.exit(0)
})

main().catch(e => {
  console.error('Ошибка:', e.message)
  process.exit(1)
})
