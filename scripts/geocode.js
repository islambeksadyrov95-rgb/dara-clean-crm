/**
 * Геокодирование адресов из Тепловая карта.xlsx
 * Источник: Nominatim (OpenStreetMap) + фильтр countrycodes=kz
 * Даёт точность на уровне здания для Алматы
 *
 * Запуск: node scripts/geocode.js
 * Прерывание: Ctrl+C — прогресс сохраняется каждые 50 адресов
 *
 * Время: ~80-100 мин для 4620 адресов (1 req/sec лимит Nominatim)
 * Результат: dashboard/data/geocoded-addresses.json
 */

'use strict'

const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')
const https = require('https')

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'DaraClean-Heatmap/1.0 (private analytics; contact: daraclean.kz)'
const DELAY_MS = 1050  // Nominatim требует ≤ 1 req/sec

const EXCEL_FILE = path.join(__dirname, '../Данные/Тепловая карта.xlsx')
const OUTPUT_FILE = path.join(__dirname, '../dashboard/data/geocoded-addresses.json')

// ——— HTTP GET ———
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru,kk' } }
    const req = https.get(url, opts, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(new Error('parse error')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ——— Bounding box Алматы + ближайшие сёла (Бесагаш, Кыргауылды)
// Запад: 76.70 (Наурызбайский р-н, исключает Каскелен ~76.64)
// Восток: 77.30 (сёла Талгарского р-на)
const ALMATY_BBOX = { minLat: 43.08, maxLat: 43.48, minLng: 76.70, maxLng: 77.30 }

function inAlmaty(lat, lng) {
  return lat >= ALMATY_BBOX.minLat && lat <= ALMATY_BBOX.maxLat &&
         lng >= ALMATY_BBOX.minLng && lng <= ALMATY_BBOX.maxLng
}

// viewbox для Nominatim: west,south,east,north
const ALMATY_VIEWBOX = `${ALMATY_BBOX.minLng},${ALMATY_BBOX.minLat},${ALMATY_BBOX.maxLng},${ALMATY_BBOX.maxLat}`

// ——— Nominatim запрос ———
// requireAlmaty: true = дополнительно проверяем что display_name содержит "Алматы"
async function geocode(params, requireAlmaty = false) {
  const qs = new URLSearchParams({
    format: 'json',
    limit: '5',
    countrycodes: 'kz',
    viewbox: ALMATY_VIEWBOX,
    bounded: '1',
    ...params
  })
  try {
    const data = await httpGet(`${NOMINATIM}?${qs}`)
    if (!Array.isArray(data)) return null
    for (const item of data) {
      const lat = parseFloat(item.lat)
      const lng = parseFloat(item.lon)
      if (!inAlmaty(lat, lng)) continue
      if (requireAlmaty) {
        const dn = item.display_name || ''
        // Проверяем что это именно г. Алматы, а не другой населённый пункт
        if (!dn.includes('Алматы') && !dn.includes('Almaty') && !dn.includes('Алмата')) continue
      }
      return { lat, lng }
    }
    return null
  } catch (e) {
    return null
  }
}

// ——— Без bounded (для сёл рядом с Алматы: Бесагаш, Кыргауылды) ———
async function geocodeUnbounded(params) {
  const qs = new URLSearchParams({
    format: 'json',
    limit: '5',
    countrycodes: 'kz',
    viewbox: ALMATY_VIEWBOX,
    bounded: '0',
    ...params
  })
  try {
    const data = await httpGet(`${NOMINATIM}?${qs}`)
    if (!Array.isArray(data)) return null
    for (const item of data) {
      const lat = parseFloat(item.lat)
      const lng = parseFloat(item.lon)
      if (inAlmaty(lat, lng)) return { lat, lng }
    }
    return null
  } catch (e) {
    return null
  }
}

// ——— Нормализация: убираем кв/этаж/подъезд ———
function stripApt(addr) {
  let a = addr.trim()
  // Убираем с конца: этаж, кв, квартира, офис, подъезд, под.
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*(\d+\s+)?(этаж\s+\d+[а-яА-Я]?)\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*квартира\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*офис\s*\d*\s*$/i, '')
  a = a.replace(/,\s*подъезд\s+\d+\s*$/i, '')
  a = a.replace(/,\s*под\.\s*\d+\s*$/i, '')
  // Ещё раз кв. если был "кв N, этаж N"
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  return a.trim()
}

// ——— Парсинг адреса на компоненты для structured query ———
// Форматы Алматы:
//   "улица NAME, HOUSE, город" → street="HOUSE NAME"
//   "проспект NAME, HOUSE, город"
//   "микрорайон NAME, HOUSE, город"
//   "NAME улица, HOUSE, город" → обратный порядок
//   "HOUSE NAME" → нет типа (Орманова 117а)
function parseAddress(raw) {
  const addr = stripApt(raw)

  // Определяем город/пригород
  let city = 'Almaty'
  let locality = null
  if (/село\s+(\S+)/i.test(addr)) {
    locality = addr.match(/село\s+(\S+)/i)[1]
    city = null
  } else if (/пгт\s+(\S+)/i.test(addr)) {
    locality = addr.match(/пгт\s+(\S+)/i)[1]
    city = null
  }

  // Убираем всё после второй запятой (город/район/область)
  const parts = addr.split(',').map(s => s.trim())

  // Типичный формат: [TYPE STREETNAME, HOUSE, CITY, ...]
  // или [STREETNAME TYPE, HOUSE, CITY]
  const STREET_TYPES = /^(улица|ул\.|проспект|пр\.|микрорайон|мкр\.?|бульвар|бул\.|переулок|пер\.|площадь|пл\.|тупик|шоссе|аллея|набережная|квартал|жилой массив|жм\.?)\s+/i

  let streetRaw = parts[0] || ''
  let houseRaw = parts[1] || ''

  // Если в parts[0] уже есть номер дома (формат "ул. NAME, HOUSE")
  const houseInStreet = streetRaw.match(/,\s*(\d+[а-яА-Яa-zA-Z/\\-]*)$/)
  if (houseInStreet) {
    houseRaw = houseInStreet[1]
    streetRaw = streetRaw.slice(0, -houseInStreet[0].length).trim()
  }

  // Убираем тип улицы из начала
  let streetName = streetRaw.replace(STREET_TYPES, '').trim()

  // Обратный порядок: "NAME улица" → убираем тип с конца
  streetName = streetName.replace(/\s+(улица|ул|проспект|пр|бульвар|бул|переулок|пер|площадь|шоссе)\.?$/i, '').trim()

  // Нормализуем номер дома — только первая часть (без кв/этаж остатков)
  const houseNum = (houseRaw || '').match(/^[\dА-Яа-яA-Za-z/\\-]+/)?.[0] || ''

  return { streetName, houseNum, city, locality }
}

// ——— Попытка геокодирования одного запроса с задержкой ———
async function tryGeocode(params, requireAlmaty = false) {
  await sleep(DELAY_MS)
  return geocode(params, requireAlmaty)
}

// ——— Убрать имя-отчество из "Абдуллы Розыбакиева" → "Розыбакиева" ———
function shortenStreetName(name) {
  // Если название улицы — "ИМЯ ФАМИЛИЯ", пробуем только фамилию (последнее слово)
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return words[words.length - 1]
  return name
}

// ——— Стратегии геокодирования ———
async function geocodeAddress(raw) {
  const { streetName, houseNum, city, locality } = parseAddress(raw)
  const cityParam = locality || city || 'Almaty'
  const stripped = stripApt(raw)

  // Очищенный адрес для unstructured запросов
  const qClean = stripped
    .replace(/,\s*(Алматинская\s+область|Талгарский\s+район|Наурызбайский\s+район)\s*$/i, '')
    .trim()

  // Стратегия 1 (ОСНОВНАЯ): unstructured bounded
  // Использует полный адрес с "улица"/"проспект"/"микрорайон" — Nominatim читает их правильно
  const coords1 = await tryGeocode({ q: qClean }, false)
  if (coords1) return coords1

  // Стратегия 2: structured — "HOUSE STREETNAME + city"
  // Используем только если unstructured не нашёл (нестандартные форматы адресов)
  if (streetName && houseNum) {
    const coords = await tryGeocode(
      { street: `${houseNum} ${streetName}`, city: cityParam },
      true  // requireAlmaty — проверяем что в display_name есть "Алматы"
    )
    if (coords) return coords
  }

  // Стратегия 3: structured, только последнее слово улицы (Абдуллы Розыбакиева → Розыбакиева)
  if (streetName && houseNum && streetName.includes(' ')) {
    const shortName = shortenStreetName(streetName)
    if (shortName !== streetName) {
      const coords = await tryGeocode(
        { street: `${houseNum} ${shortName}`, city: cityParam },
        true
      )
      if (coords) return coords
    }
  }

  // Стратегия 4: unstructured unbounded (для сёл рядом с Алматы: Бесагаш, Кыргауылды и др.)
  await sleep(DELAY_MS)
  return geocodeUnbounded({ q: qClean })
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
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
  const ni = hdr.findIndex(h => h.includes('наименование'))

  const records = []
  for (let i = hi + 1; i < raw.length; i++) {
    const row = raw[i]
    const addr = ai >= 0 ? String(row[ai] || '').trim() : ''
    if (!addr || addr === 'Адрес') continue
    records.push({
      name: ni >= 0 ? String(row[ni] || '').trim() : '',
      address: addr,
      orders: oi >= 0 ? (parseInt(row[oi]) || 1) : 1
    })
  }
  return records
}

// ——— Сохранение промежуточного результата ———
function saveOutput(uniqueList, cache, filePath) {
  const output = []
  for (const item of uniqueList) {
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
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8')
  return output.length
}

// ——— Main ———
async function main() {
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error('Файл не найден:', EXCEL_FILE)
    process.exit(1)
  }

  const records = parseExcel(EXCEL_FILE)
  console.log(`Записей с адресом: ${records.length}`)

  // Нормализованный адрес = ключ кэша
  function normKey(addr) {
    return stripApt(addr).toLowerCase().replace(/\s+/g, ' ').trim()
  }

  const addrMap = new Map()
  for (const r of records) {
    const key = normKey(r.address)
    if (!key || key.length < 5) continue
    if (!addrMap.has(key)) addrMap.set(key, { address: r.address, normalized: key, orders: 0 })
    addrMap.get(key).orders += r.orders
  }

  const uniqueList = [...addrMap.values()]
  console.log(`Уникальных адресов после дедупликации: ${uniqueList.length}`)

  // Загружаем кэш
  const cache = {}
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
      for (const r of existing) {
        if (r.normalized && r.lat && r.lng) {
          cache[r.normalized] = { lat: r.lat, lng: r.lng }
        }
      }
      console.log(`Кэш: ${Object.keys(cache).length} адресов`)
    } catch (e) {}
  }

  const toProcess = uniqueList.filter(u => !cache[u.normalized])
  console.log(`Нужно геокодировать: ${toProcess.length}`)

  if (toProcess.length === 0) {
    const n = saveOutput(uniqueList, cache, OUTPUT_FILE)
    console.log(`✓ Все в кэше. Сохранено ${n} адресов.`)
    return
  }

  // Примерное время: structured (1 запрос) + fallback (иногда 2-й)
  const etaSec = Math.ceil(toProcess.length * 1.3 * DELAY_MS / 1000)
  console.log(`\nМетод: Nominatim (OSM) + structured queries для Алматы`)
  console.log(`Скорость: 1 запрос/сек (лимит Nominatim)`)
  console.log(`Примерное время: ${Math.ceil(etaSec / 60)} мин`)
  console.log(`Прогресс сохраняется каждые 50 адресов (Ctrl+C для прерывания)\n`)

  let done = 0
  let failed = 0

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i]

    await sleep(DELAY_MS)
    const coords = await geocodeAddress(item.address)

    if (coords) {
      cache[item.normalized] = coords
      done++
    } else {
      failed++
    }

    const pct = Math.round((i + 1) / toProcess.length * 100)
    process.stdout.write(
      `\r  ${i+1}/${toProcess.length} (${pct}%) | найдено: ${done} | не найдено: ${failed}   `
    )

    if ((i + 1) % 50 === 0) {
      const saved = saveOutput(uniqueList, cache, OUTPUT_FILE)
      process.stdout.write(`\n  [сохранено ${saved} адресов]\n`)
    }
  }

  console.log('\n')
  const total = saveOutput(uniqueList, cache, OUTPUT_FILE)
  console.log(`✓ Готово! Сохранено ${total} адресов → ${OUTPUT_FILE}`)
  console.log(`  Найдено: ${done} | Не найдено: ${failed} | Из кэша: ${Object.keys(cache).length - toProcess.length}`)
}

// Обработка Ctrl+C — сохраняем прогресс
process.on('SIGINT', () => {
  console.log('\n\nПрерывание. Прогресс сохранён.')
  process.exit(0)
})

main().catch(e => {
  console.error('Ошибка:', e)
  process.exit(1)
})
