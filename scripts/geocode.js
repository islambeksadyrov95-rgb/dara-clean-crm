/**
 * Геокодирование адресов из Тепловая карта.xlsx через Nominatim (OpenStreetMap)
 * Запуск: node scripts/geocode.js
 * Результат: dashboard/data/geocoded-addresses.json
 *
 * Nominatim: бесплатно, без ключа, ~1 req/sec
 * 4620 адресов ≈ 30-40 мин (запускать можно на ночь)
 */

'use strict'

const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')
const https = require('https')

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const DELAY_MS = 1100 // Nominatim требует 1 req/sec
const USER_AGENT = 'DaraClean-Dashboard/1.0 (geocoding script)'

const EXCEL_FILE = path.join(__dirname, '../Данные/Тепловая карта.xlsx')
const OUTPUT_FILE = path.join(__dirname, '../dashboard/data/geocoded-addresses.json')

// ——— HTTP GET ———
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': USER_AGENT, ...headers }
    }
    const req = https.get(url, opts, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(new Error('JSON parse error')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ——— Geocode via Nominatim ———
async function geocodeOne(address) {
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=0&accept-language=ru`
  try {
    const data = await httpGet(url)
    if (Array.isArray(data) && data.length > 0 && data[0].lat) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    }
    return null
  } catch (e) {
    return null
  }
}

// ——— Нормализация адреса ———
function normalizeAddress(addr) {
  if (!addr || typeof addr !== 'string') return ''
  let a = addr.trim()
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*квартира\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*офис\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*под\.\s*\d+\s*$/i, '')
  a = a.replace(/,\s*подъезд\s+\d+\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?,?\s*$/i, '')
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  // Алматинская область → просто Алматы (Nominatim лучше ищет)
  a = a.replace(/Алматинская\s+область\s*$/i, 'Almaty')
  if (!/алматы|almaty/i.test(a)) {
    a = a + ', Алматы'
  }
  return a.trim().replace(/,\s*,/g, ',')
}

// ——— Парсинг Excel ———
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  let headerIdx = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (raw[i].some(c => String(c).trim() === 'Адрес')) { headerIdx = i; break }
  }
  if (headerIdx === -1) headerIdx = 1

  const headers = raw[headerIdx].map(h => String(h).trim())
  const nameCol = headers.findIndex(h => h.includes('наименование'))
  const addrCol = headers.findIndex(h => h === 'Адрес' || h.includes('Адрес'))
  const ordersCol = headers.findIndex(h => h.includes('заказ'))

  const records = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i]
    const addr = addrCol >= 0 ? String(row[addrCol] || '').trim() : ''
    if (!addr || addr === 'Адрес') continue
    records.push({
      name: nameCol >= 0 ? String(row[nameCol] || '').trim() : '',
      address: addr,
      orders: ordersCol >= 0 ? (parseInt(row[ordersCol]) || 1) : 1
    })
  }
  return records
}

// ——— Main ———
async function main() {
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error('Файл не найден:', EXCEL_FILE)
    process.exit(1)
  }

  const records = parseExcel(EXCEL_FILE)
  console.log(`Записей с адресом: ${records.length}`)

  // Дедупликация
  const addressMap = new Map()
  for (const r of records) {
    const norm = normalizeAddress(r.address)
    if (!norm || norm.length < 10) continue
    if (!addressMap.has(norm)) {
      addressMap.set(norm, { address: r.address, normalized: norm, orders: 0 })
    }
    addressMap.get(norm).orders += r.orders
  }

  const uniqueList = [...addressMap.values()]
  console.log(`Уникальных адресов: ${uniqueList.length}`)

  // Кэш
  const cache = {}
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
      for (const r of existing) {
        if (r.normalized && r.lat && r.lng) cache[r.normalized] = { lat: r.lat, lng: r.lng }
      }
      console.log(`Кэш: ${Object.keys(cache).length} адресов`)
    } catch (e) {}
  }

  const toProcess = uniqueList.filter(u => !cache[u.normalized])
  console.log(`Нужно геокодировать: ${toProcess.length}`)

  if (toProcess.length === 0) {
    console.log('Всё уже в кэше, пересборка файла...')
  } else {
    const eta = Math.ceil(toProcess.length * DELAY_MS / 1000)
    console.log(`Время через Nominatim: ~${Math.ceil(eta/60)} мин (1 адрес/сек)`)
    console.log('Начинаем...\n')
  }

  let done = 0
  let failed = 0

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i]
    const coords = await geocodeOne(item.normalized)
    if (coords) {
      cache[item.normalized] = coords
      done++
    } else {
      failed++
    }
    const pct = Math.round((i + 1) / toProcess.length * 100)
    if ((i + 1) % 10 === 0 || i + 1 === toProcess.length) {
      process.stdout.write(`\r  ${i+1}/${toProcess.length} (${pct}%) найдено: ${done}, пропущено: ${failed}   `)
    }
    // Сохраняем промежуточно каждые 100
    if ((i + 1) % 100 === 0) {
      saveOutput(uniqueList, cache, OUTPUT_FILE, false)
    }
    // Nominatim rate limit
    if (i < toProcess.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  if (toProcess.length > 0) console.log('\n')
  saveOutput(uniqueList, cache, OUTPUT_FILE, true)
}

function saveOutput(uniqueList, cache, filePath, verbose) {
  const output = []
  for (const item of uniqueList) {
    const coords = cache[item.normalized]
    if (!coords) continue
    output.push({
      address: item.address,
      normalized: item.normalized,
      orders: item.orders,
      lat: coords.lat,
      lng: coords.lng
    })
  }
  output.sort((a, b) => b.orders - a.orders)
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8')
  if (verbose) {
    console.log(`✓ Сохранено ${output.length} адресов → ${filePath}`)
  }
  return output.length
}

main().catch(e => {
  console.error('Ошибка:', e)
  process.exit(1)
})
