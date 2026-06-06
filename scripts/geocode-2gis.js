/**
 * Геокодирование через 2GIS (скрапер Playwright)
 * Открывает браузер, ищет каждый адрес на 2gis.kz, перехватывает API-ответ с координатами
 *
 * Запуск: node scripts/geocode-2gis.js
 * Требует: npm install в папке dashboard (уже установлен @playwright/test)
 *
 * Скорость: ~4 адреса/сек (4 параллельных страницы) → ~20 мин для всех адресов
 * Прогресс сохраняется каждые 100 адресов
 */

'use strict'

const { chromium } = require('../dashboard/node_modules/@playwright/test')
const XLSX = require('../dashboard/node_modules/xlsx')
const fs = require('fs')
const path = require('path')

const EXCEL_FILE = path.join(__dirname, '../Данные/Тепловая карта.xlsx')
const OUTPUT_FILE = path.join(__dirname, '../dashboard/data/geocoded-addresses.json')

const CONCURRENCY = 4      // параллельных страниц
const PAGE_DELAY_MS = 200  // пауза между запросами на одной странице
const NAV_TIMEOUT = 10000  // таймаут навигации
const WAIT_MS = 1800       // ждём API-ответа после навигации

// Bounding box Алматы + сёла
const BBOX = { minLat: 43.05, maxLat: 43.55, minLng: 76.60, maxLng: 77.40 }

function inAlmaty(lat, lng) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng
}

// ——— Парсинг Excel ———
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath)
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
    records.push({
      address: addr,
      orders: oi >= 0 ? (parseInt(row[oi]) || 1) : 1
    })
  }
  return records
}

function stripApt(addr) {
  let a = addr.trim()
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*квартира\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*офис\s*\d*\s*$/i, '')
  a = a.replace(/,\s*подъезд\s+\d+\s*$/i, '')
  a = a.replace(/,\s*под\.\s*\d+\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  return a.trim()
}

function normKey(addr) {
  return stripApt(addr).toLowerCase().replace(/\s+/g, ' ').trim()
}

// ——— Геокодирование одного адреса на одной странице ———
async function geocodeOnPage(page, address) {
  let foundCoords = null

  // Перехватываем ответы 2GIS API
  const onResponse = async (response) => {
    if (foundCoords) return
    const url = response.url()
    if (!url.includes('2gis.com') && !url.includes('2gis.ru')) return
    // Поддерживаем: /3.0/items, suggest, geocode, geo/search
    const isRelevant = url.includes('/3.0/items') || url.includes('suggest') ||
                       url.includes('geocode') || url.includes('geo/search')
    if (!isRelevant) return
    try {
      const text = await response.text()
      const json = JSON.parse(text)

      // Формат /3.0/items: result.items[].point.lat/lon
      const items = json?.result?.items || json?.data?.items || []
      for (const item of items) {
        const p = item.point
        if (p && inAlmaty(parseFloat(p.lat), parseFloat(p.lon))) {
          foundCoords = { lat: parseFloat(p.lat), lng: parseFloat(p.lon) }
          return
        }
        // Некоторые версии API возвращают geometry.centroid "lat,lon"
        const cent = item.geometry?.centroid
        if (typeof cent === 'string') {
          const parts = cent.replace(/[()]/g, '').split(/\s+/)
          // POINT(lng lat)
          const lng = parseFloat(parts[1] || parts[0])
          const lat = parseFloat(parts[2] || parts[1])
          if (inAlmaty(lat, lng)) { foundCoords = { lat, lng }; return }
        }
      }

      // Формат suggest: suggestions[].data.point
      const sugs = json?.suggestions || []
      for (const s of sugs) {
        const p = s.data?.point || s.point
        if (p && inAlmaty(parseFloat(p.lat), parseFloat(p.lon || p.lng))) {
          foundCoords = { lat: parseFloat(p.lat), lng: parseFloat(p.lon || p.lng) }
          return
        }
      }
    } catch {
      // не JSON или другой формат — пропускаем
    }
  }

  page.on('response', onResponse)

  try {
    const searchUrl = `https://2gis.kz/almaty/search/${encodeURIComponent(address)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    await page.waitForTimeout(WAIT_MS)

    // Из URL страницы (?m=LNG,LAT/ZOOM) — работает в 84% случаев
    if (!foundCoords) {
      const finalUrl = page.url()
      const mMatch = finalUrl.match(/[?&]m=([\d.]+)[%2C,]+([\d.]+)/i)
      if (mMatch) {
        const lng = parseFloat(mMatch[1])
        const lat = parseFloat(mMatch[2])
        const isDefault = Math.abs(lng - 76.889709) < 0.005 && Math.abs(lat - 43.238293) < 0.005
        if (inAlmaty(lat, lng) && !isDefault) {
          foundCoords = { lat, lng }
        }
      }
    }

    // Из window.__INITIAL_STATE__
    if (!foundCoords) {
      try {
        const coords = await page.evaluate(() => {
          const state = window.__INITIAL_STATE__ || window.__data__ || {}
          const items = state?.search?.result?.items || []
          for (const item of items) {
            if (item?.point?.lat && item?.point?.lon) {
              return { lat: item.point.lat, lng: item.point.lon }
            }
          }
          return null
        })
        if (coords && inAlmaty(coords.lat, coords.lng)) foundCoords = coords
      } catch {}
    }
  } catch (e) {
    // Навигация не удалась — пропускаем
  }

  page.off('response', onResponse)
  return foundCoords
}

// ——— Сохранение ———
function saveOutput(addrMap, cache) {
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
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8')
  return output.length
}

// ——— Воркер: обрабатывает свой список адресов ———
async function worker(browser, items, cache, stats) {
  const page = await browser.newPage()

  // Stealth: скрываем признаки автоматизации
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
  })

  // Блокируем лишние ресурсы (картинки, шрифты) для скорости
  await page.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf}', route => route.abort())

  // Добавляем fields=items.point к запросам каталога 2GIS — чтобы пришли координаты
  await page.route(/catalog\.api\.2gis\.(ru|com)\/3\.0\/items/, async (route) => {
    let url = route.request().url()
    if (!url.includes('fields=')) {
      url += (url.includes('?') ? '&' : '?') + 'fields=items.point'
    }
    await route.continue({ url })
  })

  for (const item of items) {
    if (cache[item.normalized]) {
      stats.cached++
      continue
    }

    await new Promise(r => setTimeout(r, PAGE_DELAY_MS))

    const coords = await geocodeOnPage(page, item.address)
    if (coords) {
      cache[item.normalized] = coords
      stats.done++
    } else {
      stats.failed++
    }

    stats.processed++
    const total = stats.done + stats.failed + stats.cached
    const pct = Math.round(total / stats.total * 100)
    process.stdout.write(
      `\r  ${total}/${stats.total} (${pct}%) | найдено: ${stats.done} | не найдено: ${stats.failed} | кэш: ${stats.cached}   `
    )
  }

  await page.close()
}

// ——— Main ———
async function main() {
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error('Файл не найден:', EXCEL_FILE)
    process.exit(1)
  }

  // Парсим Excel
  const records = parseExcel(EXCEL_FILE)
  console.log(`Записей: ${records.length}`)

  // Дедупликация
  const addrMap = new Map()
  for (const r of records) {
    const key = normKey(r.address)
    if (!key || key.length < 5) continue
    if (!addrMap.has(key)) addrMap.set(key, { address: r.address, normalized: key, orders: 0 })
    addrMap.get(key).orders += r.orders
  }

  const uniqueList = [...addrMap.values()]
  console.log(`Уникальных адресов: ${uniqueList.length}`)

  // Загружаем кэш
  const cache = {}
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
      for (const r of existing) {
        if (r.normalized && r.lat && r.lng) cache[r.normalized] = { lat: r.lat, lng: r.lng }
      }
      console.log(`Кэш: ${Object.keys(cache).length} адресов`)
    } catch {}
  }

  const toProcess = uniqueList.filter(u => !cache[u.normalized])
  console.log(`Осталось геокодировать: ${toProcess.length}`)

  if (toProcess.length === 0) {
    const n = saveOutput(addrMap, cache)
    console.log(`✓ Все в кэше. Файл: ${n} адресов.`)
    return
  }

  const etaMin = Math.ceil(toProcess.length / CONCURRENCY / (1000 / PAGE_DELAY_MS) * 2)
  console.log(`\nМетод: 2GIS скрапер (${CONCURRENCY} параллельных вкладки)`)
  console.log(`Примерное время: ~${etaMin} мин`)
  console.log(`Сохранение каждые 100 адресов (Ctrl+C для паузы)\n`)

  const browser = await chromium.launch({
    headless: false,  // видимый браузер — обходит CAPTCHA 2GIS
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  })

  // Разбиваем на CONCURRENCY частей
  const chunks = Array.from({ length: CONCURRENCY }, (_, i) =>
    toProcess.filter((_, idx) => idx % CONCURRENCY === i)
  )

  const stats = { done: 0, failed: 0, cached: Object.keys(cache).length, processed: 0, total: uniqueList.length }

  // Периодическое сохранение
  let lastSaved = Date.now()
  const saveInterval = setInterval(() => {
    const n = saveOutput(addrMap, cache)
    const elapsed = Math.round((Date.now() - lastSaved) / 1000)
    process.stdout.write(`\n  [сохранено ${n} адресов, +${elapsed}с]\n`)
    lastSaved = Date.now()
  }, 30000) // каждые 30 секунд

  try {
    await Promise.all(chunks.map(chunk => worker(browser, chunk, cache, stats)))
  } finally {
    clearInterval(saveInterval)
    await browser.close()
  }

  console.log('\n')
  const total = saveOutput(addrMap, cache)
  console.log(`✓ Готово! Сохранено ${total} адресов → ${OUTPUT_FILE}`)
  console.log(`  Найдено: ${stats.done} | Не найдено: ${stats.failed}`)
}

process.on('SIGINT', () => {
  console.log('\nПрерывание. Данные уже сохранены в файл.')
  process.exit(0)
})

main().catch(e => {
  console.error('Ошибка:', e.message)
  process.exit(1)
})
