/**
 * Генерирует демо-данные с реальными координатами Алматы для тепловой карты
 * на основе реальных данных из Excel
 * Запуск: node scripts/generate-demo.js
 */
'use strict'

const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const EXCEL_FILE = path.join(__dirname, '../Данные/Тепловая карта.xlsx')
const OUTPUT_FILE = path.join(__dirname, '../dashboard/data/geocoded-addresses.json')

// Реальные координаты знаковых адресов Алматы (из теста 2GIS API)
// Расширенная база адресов с реальными координатами
const KNOWN_COORDS = {
  'улица Кабанбай батыра, 47Б, Алматы': { lat: 43.251715, lng: 76.961982 },
  // Центральные улицы
  'площадь Республики': { lat: 43.2380, lng: 76.9428 },
  'проспект Абылай хана': { lat: 43.2570, lng: 76.9450 },
  'улица Панфилова': { lat: 43.2564, lng: 76.9378 },
  'улица Толе би': { lat: 43.2514, lng: 76.9480 },
  'улица Курмангазы': { lat: 43.2550, lng: 76.9360 },
  'улица Сейфуллина': { lat: 43.2590, lng: 76.9280 },
  'улица Фурманова': { lat: 43.2520, lng: 76.9550 },
  'улица Байтурсынова': { lat: 43.2540, lng: 76.9120 },
  'проспект Достык': { lat: 43.2340, lng: 76.9600 },
  // Бостандык
  'улица Абдуллы Розыбакиева': { lat: 43.2020, lng: 76.8940 },
  'улица Навои': { lat: 43.2350, lng: 76.8720 },
  'улица Жандосова': { lat: 43.2080, lng: 76.8820 },
  'проспект Момышулы': { lat: 43.2420, lng: 76.8680 },
  'проспект Аль-Фараби': { lat: 43.2290, lng: 76.9260 },
  'улица Тимирязева': { lat: 43.2430, lng: 76.8990 },
  'микрорайон Орбита': { lat: 43.2150, lng: 76.8850 },
  'микрорайон Самал': { lat: 43.2280, lng: 76.9310 },
  // Медеуский
  'улица Каирбекова': { lat: 43.2600, lng: 76.9700 },
  'улица Хаби Халиуллина': { lat: 43.2480, lng: 76.9650 },
  'улица Шафика Чокина': { lat: 43.2390, lng: 76.9720 },
  'улица Сагадата Нурмагамбетова': { lat: 43.2200, lng: 76.9800 },
  'микрорайон Коктем': { lat: 43.2680, lng: 76.9530 },
  'микрорайон Коктем-1': { lat: 43.2680, lng: 76.9530 },
  'микрорайон Коктем-2': { lat: 43.2700, lng: 76.9550 },
  'улица Садовая': { lat: 43.2610, lng: 76.9760 },
  // Ауэзовский
  'микрорайон Аксай': { lat: 43.2300, lng: 76.8200 },
  'микрорайон Аксай-1': { lat: 43.2280, lng: 76.8150 },
  'микрорайон Аксай-2': { lat: 43.2300, lng: 76.8200 },
  'микрорайон Аксай-3': { lat: 43.2320, lng: 76.8250 },
  'микрорайон Аксай-4': { lat: 43.2340, lng: 76.8300 },
  'микрорайон Мамыр': { lat: 43.2500, lng: 76.8350 },
  'микрорайон Думан': { lat: 43.3100, lng: 76.9680 },
  'микрорайон Думан-2': { lat: 43.3120, lng: 76.9700 },
  'улица Жибек Жолы': { lat: 43.2600, lng: 76.9350 },
  'микрорайон 12': { lat: 43.2640, lng: 76.8480 },
  'Мкр 12': { lat: 43.2640, lng: 76.8480 },
  // Наурызбайский
  'микрорайон Шугыла': { lat: 43.2200, lng: 76.7820 },
  'улица Ер Тостык': { lat: 43.2350, lng: 76.7950 },
  // Турксибский
  'улица Сарыарка': { lat: 43.3050, lng: 77.0450 },
  'микрорайон Айнабулак': { lat: 43.3200, lng: 77.0200 },
  'микрорайон Айнабулак-1': { lat: 43.3180, lng: 77.0150 },
  'улица Шемякина': { lat: 43.3100, lng: 77.0100 },
  'Лисаковская улица': { lat: 43.3080, lng: 77.0080 },
  // Другие
  'улица Таттимбета': { lat: 43.2180, lng: 76.9650 },
  'улица Луганского': { lat: 43.2250, lng: 76.8720 },
  'улица Едила Ергожина': { lat: 43.2550, lng: 76.9150 },
  'улица Таштитова': { lat: 43.2490, lng: 76.8930 },
  'улица Алимжанова': { lat: 43.2700, lng: 76.9400 },
  'улица Талант': { lat: 43.2380, lng: 76.9010 },
  'улица Орманова': { lat: 43.2420, lng: 76.9180 },
  'микрорайон Орбита-2': { lat: 43.2130, lng: 76.8900 },
  'улица Курсары': { lat: 43.2480, lng: 76.9570 },
  'улица Сергея Луганского': { lat: 43.2250, lng: 76.8720 },
  'улица С. Дунентаева': { lat: 43.2560, lng: 76.8980 },
  'проспект Суюнбая': { lat: 43.3250, lng: 77.0350 },
  'Суюнбая улица': { lat: 43.3250, lng: 77.0350 },
  'улица Богенбай батыра': { lat: 43.2530, lng: 76.9480 },
  'улица Кенесары хана': { lat: 43.2600, lng: 76.9310 },
  'микрорайон Горный гигант': { lat: 43.1980, lng: 76.9570 },
  'улица Рыскулова': { lat: 43.2850, lng: 76.9100 },
  'улица Утеген батыра': { lat: 43.2550, lng: 77.0150 },
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
  const addrCol = headers.findIndex(h => h === 'Адрес' || h.includes('Адрес'))
  const ordersCol = headers.findIndex(h => h.includes('заказ'))
  const nameCol = headers.findIndex(h => h.includes('наименование'))

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

// ——— Нормализация ———
function normalizeAddress(addr) {
  let a = addr.trim()
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*квартира\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*офис\s+\d+[а-яА-Я]?\s*$/i, '')
  a = a.replace(/,\s*под\.\s*\d+\s*$/i, '')
  a = a.replace(/,\s*подъезд\s+\d+\s*$/i, '')
  a = a.replace(/,\s*кв\.?\s*\d+[а-яА-Я]?,?\s*$/i, '')
  a = a.replace(/,\s*этаж\s+\d+[а-яА-Я]?\s*$/i, '')
  return a.trim()
}

// ——— Найти координаты по части адреса ———
function findCoords(address) {
  const a = normalizeAddress(address)

  // Точное совпадение с базой
  for (const [key, coords] of Object.entries(KNOWN_COORDS)) {
    if (a.toLowerCase().includes(key.toLowerCase())) {
      return coords
    }
  }

  return null
}

// ——— Рассчитать центр по районам на основе ключевых слов ———
const DISTRICT_COORDS = [
  { pat: /бостандык|самал|орбита|навои|розыбакиева|тимирязева|аль.?фараби|жандосова|момышулы|байтурсынова|аксай|горный.гигант|ул.луганского|сергея.луганского|кок.тобе/i, lat: 43.215, lng: 76.890, spread: 0.03 },
  { pat: /медеу|достык|кабанбай|толе.?би|панфилова|курмангазы|шевченко|фурманова|виноградова|тулебаева|шафика|хаби.хали|каирбеков|нурмагамбетов|таттимбет|коктем|садовая/i, lat: 43.248, lng: 76.965, spread: 0.025 },
  { pat: /ауэзов|мамыр|думан|12.мкр|мкр.12|берег|саина|мкр.1\d/i, lat: 43.248, lng: 76.838, spread: 0.035 },
  { pat: /наурызбай|шугыла|каргалы|акши|ер.тостык/i, lat: 43.215, lng: 76.775, spread: 0.04 },
  { pat: /турксиб|сарыарка|айнабулак|кайрат|суюнбая|шемякина|лисак/i, lat: 43.305, lng: 77.030, spread: 0.04 },
  { pat: /жетысу|зердели|алатау|богенбай|утеген/i, lat: 43.265, lng: 77.030, spread: 0.03 },
  { pat: /абылай|кенесары|панфилова|алматы.*центр|республики|сейфуллин|байтурсын|рыскулова|алимжанов|талант|орманов|курсары|дунентаева|ергожин|таштитова/i, lat: 43.255, lng: 76.935, spread: 0.025 },
  { pat: /бесагаш|талгарский/i, lat: 43.285, lng: 77.115, spread: 0.04 },
  { pat: /кыргауылды/i, lat: 43.26, lng: 77.16, spread: 0.03 },
]

function getDistrictCoords(address) {
  const a = address.toLowerCase()
  for (const d of DISTRICT_COORDS) {
    if (d.pat.test(a)) {
      const jitter = () => (Math.random() - 0.5) * 2 * d.spread
      return {
        lat: d.lat + jitter(),
        lng: d.lng + jitter()
      }
    }
  }
  // Дефолт — центр Алматы с большим разбросом
  return {
    lat: 43.238 + (Math.random() - 0.5) * 0.08,
    lng: 76.920 + (Math.random() - 0.5) * 0.10
  }
}

// ——— Главная ———
function main() {
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error('Файл не найден:', EXCEL_FILE)
    process.exit(1)
  }

  const records = parseExcel(EXCEL_FILE)
  console.log('Записей:', records.length)

  // Дедупликация
  const addrMap = new Map()
  for (const r of records) {
    const norm = normalizeAddress(r.address)
    if (!norm || norm.length < 5) continue
    if (!addrMap.has(norm)) addrMap.set(norm, { address: r.address, normalized: norm, orders: 0 })
    addrMap.get(norm).orders += r.orders
  }

  const uniqueList = [...addrMap.values()]
  console.log('Уникальных адресов:', uniqueList.length)

  // Назначаем координаты
  const output = []
  let exactMatches = 0
  let districtMatches = 0

  for (const item of uniqueList) {
    let coords = findCoords(item.address)
    if (coords) {
      // Точное совпадение — добавляем небольшой jitter для домов на одной улице
      const jitter = 0.0008 // ~80 метров
      coords = {
        lat: coords.lat + (Math.random() - 0.5) * jitter,
        lng: coords.lng + (Math.random() - 0.5) * jitter
      }
      exactMatches++
    } else {
      coords = getDistrictCoords(item.address)
      districtMatches++
    }

    output.push({
      address: item.address,
      normalized: item.normalized,
      orders: item.orders,
      lat: parseFloat(coords.lat.toFixed(6)),
      lng: parseFloat(coords.lng.toFixed(6))
    })
  }

  output.sort((a, b) => b.orders - a.orders)

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8')
  console.log(`✓ Сохранено ${output.length} адресов`)
  console.log(`  Точных совпадений: ${exactMatches}`)
  console.log(`  По районам: ${districtMatches}`)
  console.log(`  → ${OUTPUT_FILE}`)
  console.log('\nПримечание: это приближённые координаты на уровне района/улицы.')
  console.log('Для точных координат запустите: node scripts/geocode.js (требует geocoding API key)')
}

main()
