// ===== DaraClean Finance API (Telegram Bot <-> Google Sheets) =====
// Deploy -> New deployment -> Web app -> Anyone -> Deploy
// URL вида https://script.google.com/macros/s/.../exec = APPS_SCRIPT_BASE_URL
// apiKey ниже = APPS_SCRIPT_API_KEY

const FIN_API_CONFIG = {
  apiKey: 'DaraClean_2026_Secret_12345',
  sheetNames: {
    dict: 'Справочник',
    entries: 'Ежедневно'
  }
}

const finJson_ = (payload) =>
  ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON)

const finGetAction_ = (e) => (e && e.parameter && e.parameter.action) || ''

const finParseBody_ = (e) => {
  if (!e || !e.postData || !e.postData.contents) return {}
  try {
    return JSON.parse(e.postData.contents)
  } catch (error) {
    return {}
  }
}

const finRequireApiKey_ = (body) => {
  if (!body || body.apiKey !== FIN_API_CONFIG.apiKey) throw new Error('Unauthorized')
}

const finGetSheet_ = (name) => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
  if (!sheet) throw new Error(`Sheet not found: ${name}`)
  return sheet
}

// ===== DICT =====

const finReadDictionary_ = () => {
  const sheet = finGetSheet_(FIN_API_CONFIG.sheetNames.dict)
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()
  if (lastRow < 2 || lastCol < 1) {
    return { operationTypes: [], paymentTypes: [], categories: [], articlesByCategory: {}, employees: [] }
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const headers = values[0].map((h) => String(h || '').trim())

  const findCol = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())

  const colOperationType = findCol('Тип операции')
  const colPaymentType = findCol('Тип оплаты')
  const colCategory = findCol('Категория')
  const colArticle = findCol('Статья')
  const colEmployee = findCol('Сотрудник')

  const operationTypes = new Set()
  const paymentTypes = new Set()
  const categories = new Set()
  const employees = new Set()
  const articlesByCategory = {}

  for (let i = 1; i < values.length; i++) {
    const row = values[i]
    const op = colOperationType >= 0 ? String(row[colOperationType] || '').trim() : ''
    const pay = colPaymentType >= 0 ? String(row[colPaymentType] || '').trim() : ''
    const cat = colCategory >= 0 ? String(row[colCategory] || '').trim() : ''
    const art = colArticle >= 0 ? String(row[colArticle] || '').trim() : ''
    const emp = colEmployee >= 0 ? String(row[colEmployee] || '').trim() : ''

    if (op) operationTypes.add(op)
    if (pay) paymentTypes.add(pay)
    if (cat) categories.add(cat)
    if (emp) employees.add(emp)

    if (cat && art) {
      if (!articlesByCategory[cat]) articlesByCategory[cat] = new Set()
      articlesByCategory[cat].add(art)
    }
  }

  const articlesByCategoryOut = {}
  Object.keys(articlesByCategory).forEach((cat) => {
    articlesByCategoryOut[cat] = Array.from(articlesByCategory[cat]).sort()
  })

  return {
    operationTypes: Array.from(operationTypes).sort(),
    paymentTypes: Array.from(paymentTypes).sort(),
    categories: Array.from(categories).sort(),
    articlesByCategory: articlesByCategoryOut,
    employees: Array.from(employees).sort()
  }
}

// ===== ENTRIES =====
// Пишем в "Ежедневно" в 12 колонок подряд, начиная с A:
// 1 dateIso
// 2 operationType
// 3 paymentType
// 4 category
// 5 article
// 6 employee
// 7 amount
// 8 comment
// 9 chatId
// 10 userId
// 11 username
// 12 createdAtIso

const finAddEntry_ = (body) => {
  const required = ['chatId', 'userId', 'createdAtIso', 'dateIso', 'operationType', 'paymentType', 'category', 'article', 'amount']
  required.forEach((key) => {
    if (body[key] == null || body[key] === '') throw new Error(`Missing: ${key}`)
  })

  const sheet = finGetSheet_(FIN_API_CONFIG.sheetNames.entries)

  const row = [
    body.dateIso,
    body.operationType,
    body.paymentType,
    body.category,
    body.article,
    body.employee || '',
    Number(body.amount),
    body.comment || '',
    String(body.chatId),
    String(body.userId),
    body.username || '',
    body.createdAtIso
  ]

  sheet.appendRow(row)
  const rowNumber = sheet.getLastRow()
  return { ok: true, message: 'Запись добавлена', rowNumber }
}

const finGetEntryValues_ = () => {
  const sheet = finGetSheet_(FIN_API_CONFIG.sheetNames.entries)
  const lastRow = sheet.getLastRow()
  if (lastRow < 1) return []
  const lastCol = Math.max(12, sheet.getLastColumn())
  return sheet.getRange(1, 1, lastRow, lastCol).getValues()
}

const finListEntries_ = (body) => {
  const limit = Math.max(1, Math.min(50, Number(body.limit || 10)))
  const values = finGetEntryValues_()
  if (values.length < 2) return { ok: true, entries: [] }

  const data = values.slice(1)
  const recent = data.slice(Math.max(0, data.length - limit)).reverse()

  const entries = recent
    .map((r) => ({
      dateIso: String(r[0] || ''),
      operationType: String(r[1] || ''),
      paymentType: String(r[2] || ''),
      category: String(r[3] || ''),
      article: String(r[4] || ''),
      employee: String(r[5] || '') || undefined,
      amount: Number(r[6] || 0),
      comment: String(r[7] || '') || undefined
    }))
    .filter((e) => e.dateIso && e.operationType && e.category && e.article)

  return { ok: true, entries }
}

const finMonthStats_ = (body) => {
  const month = String(body.month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month format, expected YYYY-MM')

  const values = finGetEntryValues_()
  const data = values.slice(1)

  const totalsByCategory = {}
  let total = 0

  for (let i = 0; i < data.length; i++) {
    const r = data[i]
    const dateIso = String(r[0] || '')
    if (!dateIso.startsWith(month)) continue

    const operationType = String(r[1] || '')
    const category = String(r[3] || '')
    const amount = Number(r[6] || 0)
    if (!category || !Number.isFinite(amount)) continue

    const isExpense = operationType.toLowerCase().includes('расход') || operationType.toLowerCase().includes('минус')
    const signed = isExpense ? -Math.abs(amount) : Math.abs(amount)

    totalsByCategory[category] = (totalsByCategory[category] || 0) + signed
    total += signed
  }

  return { ok: true, month, totalsByCategory, total }
}

// ===== ENTRYPOINT =====

function doPost(e) {
  const action = finGetAction_(e)
  const body = finParseBody_(e)

  try {
    finRequireApiKey(body)

    if (action === 'dict') return finJson_(finReadDictionary_())
    if (action === 'entry.add') return finJson_(finAddEntry_(body))
    if (action === 'entry.list') return finJson_(finListEntries_(body))
    if (action === 'stats.month') return finJson_(finMonthStats_(body))

    return finJson_({ ok: false, message: 'Unknown action' })
  } catch (error) {
    return finJson_({ ok: false, message: String(error && error.message ? error.message : error) })
  }
}

