'use strict'

/**
 * Геокодирование через прямые HTTP запросы к 2GIS API
 * Не нужен браузер — работает через fetch/https
 * Запуск: node scripts/geocode-api.js
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const XLSX = require('../dashboard/node_modules/xlsx')

const EXCEL_FILE = path.join(__dirname, '../Данные/Тепловая карта.xlsx')
const OUTPUT_FILE = path.join(__dirname, '../dashboard/data/geocoded-addresses.json')

const CONCURRENCY = 8       // параллельных запросов
const DELAY_MS = 150        // пауза между запросами
const BBOX = { minLat: 43.05, maxLat: 43.55, minLng: 76.60, maxLng: 77.40 }

// Ключ 2GIS MapGL (публичный, для рендеринга карты)
const MAP_KEY = 'ba9c5d28-9cb8-4c35-8eb3-9023496ba786'

function inAlmaty(lat, lng) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng
}

// ——— HTTP запрос через https ———
function httpGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Referer': 'https://2gis.kz/',
        'Origin': 'https://2gis.kz'
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, json: null }) }
      })
    })
    req.on('error', () => resolve({ status: 0, json: null }))
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, json: null }) })
  })
}

// ——— Геокодирование одного адреса ———
async function geocodeAddress(address) {
  // Стратегия 1: 2GIS suggest API (публичный)
  const q1 = encodeURIComponent(`${address}, Алматы`)
  const url1 = `https://suggest.api.2gis.ru/v1/suggest?q=${q1}&fields=items.point&locale=ru_KZ&types=building,street,attraction&key=${MAP_KEY}`
  const r1 = await httpGet(url1)
  if (r1.json) {
    const items = r1.json?.result?.items || r1.json?.items || []
    for (const item of items) {
      const p = item.point
      if (p && inAlmaty(parseFloat(p.lat), parseFloat(p.lon || p.lng))) {
        return { lat: parseFloat(p.lat), lng: parseFloat(p.lon || p.lng) }
      }
    }
  }

  // Стратегия 2: 2GIS geocoding API через catalog
  const q2 = encodeURIComponent(address)
  const url2 = `https://catalog.api.2gis.ru/3.0/items?key=${MAP_KEY}&q=${q2}+Алматы&fields=items.point&type=geo&locale=ru_KZ`
  const r2 = await httpGet(url2)
  if (r2.json) {
    const items = r2.json?.result?.items || []
    for (const item of items) {
      const p = item.point
      if (p && inAlmaty(parseFloat(p.lat), parseFloat(p.lon))) {
        return { lat: parseFloat(p.lat), lng: parseFloat(p.lon) }
      }
    }
  }

  // Стратегия 3: Nominatim (OpenStreetMap) как резерв
  const q3 = encodeURIComponent(`${address}, Алматы, Казахстан`)
  const url3 = `https://nominatim.openstreetmap.org/search?q=${q3}&format=json&limit=3&countrycodes=kz&viewbox=76.6,43.05,77.4,43.55&bounded=1`
  const r3 = await httpGet(url3)
  if (r3.json && Array.isArray(r3.json)) {
    for (const item of r3.json) {
      const lat = parseFloat(item.lat)
      const lng = parseFloat(item.lon)
      if (inAlmaty(lat, lng)) return { lat, lng }
    }
  }

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

function stripApt(addr) {
  return addr.trim()
    .replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
    .replace(/,\s*квартира\s+\d+[а-яА-Я]?\s*$/i, '')
    .replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
    .replace(/,\s*офис\s*\d*\s*$/i, '')
    .replace(/,\s*подъезд\s+\d+\s*$/i, '')
    .replace(/,\s*под\.\s*\d+\s*$/i, '')
    .trim()
}

function normKey(addr) {
  return stripApt(addr).toLowerCase().replace(/\s+/g, ' ').trim()
}

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

// ——— Обработка очереди с параллельностью ———
async function processQueue(queue, cache, addrMap, stats) {
  let idx = 0

  async function worker() {
    while (idx < queue.length) {
      const item = queue[idx++]

      if (cache[item.normalized]) {
        stats.cached++
        stats.processed++
        printProgress(stats)
        continue
      }

      await new Promise(r => setTimeout(r, DELAY_MS))

      const coords = await geocodeAddress(item.address)
      if (coords) {
        cache[item.normalized] = coords
        stats.done++
      } else {
        stats.failed++
      }
      stats.processed++
      printProgress(stats)

      // Сохраняем каждые 50 новых найденных
      if ((stats.done + stats.failed) % 50 === 0) {
        const n = saveOutput(addrMap, cache)
        process.stdout.write(`\n  [сохранено ${n} адресов]\n`)
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)
}

function printProgress(stats) {
  const pct = Math.round(stats.processed / stats.total * 100)
  process.stdout.write(
    `\r  ${stats.processed}/${stats.total} (${pct}%) | найдено: ${stats.done} | не найдено: ${stats.failed} | кэш: ${stats.cached}   `
  )
}

async function main() {
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
  console.log(`Осталось: ${toProcess.length}`)

  if (toProcess.length === 0) {
    const n = saveOutput(addrMap, cache)
    console.log(`✓ Все в кэше. ${n} адресов.`)
    return
  }

  // Тест первого запроса
  console.log('\nПроверяю API...')
  const testResult = await geocodeAddress('улица Жарокова 10')
  if (testResult) {
    console.log(`✓ API работает: ${testResult.lat}, ${testResult.lng}`)
  } else {
    console.log('✗ API не отвечает. Проверьте соединение.')
  }

  const etaSec = Math.ceil(toProcess.length / CONCURRENCY * DELAY_MS / 1000)
  console.log(`\nСкорость: ${CONCURRENCY} параллельных | ~${Math.ceil(etaSec/60)} мин\n`)

  const stats = { done: 0, failed: 0, cached: Object.keys(cache).length, processed: 0, total: uniqueList.length }

  await processQueue(uniqueList, cache, addrMap, stats)

  console.log('\n')
  const total = saveOutput(addrMap, cache)
  console.log(`✓ Готово! Сохранено ${total} адресов`)
  console.log(`  Найдено: ${stats.done} | Не найдено: ${stats.failed}`)
}

process.on('SIGINT', () => {
  console.log('\nПрерывание.')
  process.exit(0)
})

main().catch(e => {
  console.error('Ошибка:', e.message)
  process.exit(1)
})
