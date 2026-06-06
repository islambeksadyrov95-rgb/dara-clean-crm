import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import { env } from './env.js'

export type Dictionary = {
  operationTypes: string[]
  paymentTypes: string[]
  categories: string[]
  articlesByCategory: Record<string, string[]>
}

export type EntryRow = {
  date: string
  operationType: string
  paymentType: string
  amount: number
  category: string
  article: string
  comment?: string
}

const auth = new JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const doc = new GoogleSpreadsheet(env.GOOGLE_SPREADSHEET_ID, auth)

let docLoaded = false
const ensureLoaded = async () => {
  if (!docLoaded) {
    await doc.loadInfo()
    docLoaded = true
  }
}

const getSheet = async (name: string) => {
  await ensureLoaded()
  const sheet = doc.sheetsByTitle[name]
  if (!sheet) throw new Error(`Лист "${name}" не найден в таблице`)
  return sheet
}

// ── Справочник ──

export const getDictionary = async (): Promise<Dictionary> => {
  const sheet = await getSheet('Справочник')
  const rows = await sheet.getRows()

  const operationTypes = new Set<string>()
  const paymentTypes = new Set<string>()
  const categories = new Set<string>()
  const articlesByCategory: Record<string, Set<string>> = {}

  for (const row of rows) {
    const op = (row.get('Тип операции') || '').trim()
    const pay = (row.get('Тип оплаты') || '').trim()
    const cat = (row.get('Категория') || '').trim()
    const art = (row.get('Статья') || '').trim()

    if (op) operationTypes.add(op)
    if (pay) paymentTypes.add(pay)
    if (cat) categories.add(cat)

    if (cat && art) {
      if (!articlesByCategory[cat]) articlesByCategory[cat] = new Set()
      articlesByCategory[cat].add(art)
    }
  }

  const articlesByCategoryOut: Record<string, string[]> = {}
  for (const [cat, arts] of Object.entries(articlesByCategory)) {
    articlesByCategoryOut[cat] = Array.from(arts).sort()
  }

  return {
    operationTypes: Array.from(operationTypes).sort(),
    paymentTypes: Array.from(paymentTypes).sort(),
    categories: Array.from(categories).sort(),
    articlesByCategory: articlesByCategoryOut
  }
}

// ── Запись в "Ежедневно" ──
// Колонки: A Дата | B Тип операции | C Тип оплаты | D Сумма | E Категория | F Статья | G Сотрудник (пусто) | H Комментарий

export const addEntry = async (payload: {
  date: string // ДД.ММ.ГГГГ
  operationType: string
  paymentType: string
  amount: number
  category: string
  article: string
  comment?: string
}) => {
  const sheet = await getSheet('Ежедневно')

  // Находим реальную последнюю строку: читаем колонку A и ищем последнюю непустую
  const colA = await sheet.getCellsInRange(`A1:A${sheet.rowCount}`)
  let lastDataRow = 0
  if (colA) {
    for (let i = colA.length - 1; i >= 0; i--) {
      if (colA[i] && String(colA[i]).trim()) {
        lastDataRow = i + 1 // +1 т.к. индекс с 0, а строки с 1
        break
      }
    }
  }

  const targetRow = lastDataRow + 1

  // Загружаем ячейки целевой строки и записываем значения
  await sheet.loadCells(`A${targetRow}:H${targetRow}`)

  const values = [
    payload.date,
    payload.operationType,
    payload.paymentType,
    payload.amount,
    payload.category,
    payload.article,
    '',  // Сотрудник — пустой
    payload.comment || ''
  ]

  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  for (let i = 0; i < cols.length; i++) {
    const cell = sheet.getCellByA1(`${cols[i]}${targetRow}`)
    // Для числа — numberValue, для строк — stringValue без апострофа
    if (typeof values[i] === 'number') {
      cell.numberValue = values[i] as number
    } else {
      cell.value = values[i]
    }
  }

  await sheet.saveUpdatedCells()

  return { ok: true, message: 'Запись добавлена', rowNumber: targetRow }
}

// ── Чтение последних записей ──

export const listEntries = async (limit = 10) => {
  const sheet = await getSheet('Ежедневно')
  const rows = await sheet.getRows()

  if (!rows.length) return { ok: true, entries: [] as EntryRow[] }

  const recent = rows.slice(Math.max(0, rows.length - limit)).reverse()

  const entries: EntryRow[] = recent
    .map((r) => ({
      date: r.get('Дата') || '',
      operationType: r.get('Тип операции') || '',
      paymentType: r.get('Тип оплаты') || '',
      amount: parseRuNumber(r.get('Сумма') || '0'),
      category: r.get('Категория') || '',
      article: r.get('Статья') || '',
      comment: r.get('Комментарий') || undefined
    }))
    .filter((e) => e.date && e.operationType && e.category)

  return { ok: true, entries }
}

// ── Статистика за месяц ──

export const monthStats = async (month: number, year: number) => {
  const sheet = await getSheet('Ежедневно')
  const rows = await sheet.getRows()

  const totalsByCategory: Record<string, number> = {}
  let total = 0

  for (const r of rows) {
    const dateStr = r.get('Дата') || ''
    const parsed = parseDdMmYyyy(dateStr)
    if (!parsed || parsed.month !== month || parsed.year !== year) continue

    const operationType = r.get('Тип операции') || ''
    const category = r.get('Категория') || ''
    const amount = parseRuNumber(r.get('Сумма') || '0')
    if (!category || !Number.isFinite(amount)) continue

    const isExpense = operationType.toLowerCase().includes('расход')
    const signed = isExpense ? -Math.abs(amount) : Math.abs(amount)

    totalsByCategory[category] = (totalsByCategory[category] || 0) + signed
    total += signed
  }

  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  return { ok: true, month: monthStr, totalsByCategory, total }
}

// ── ДДС (Движение Денежных Средств) ──

export type DdsCategory = {
  label: string
  values: number[]
  total: number
  children: DdsCategory[]
  isHeader: boolean // Доходы, Расходы, Итого, Чистый доход
}

export const getDds = async (year: number): Promise<{ categories: DdsCategory[]; months: string[] }> => {
  const sheetName = `ДДС ${year}`
  const sheet = await getSheet(sheetName)

  await sheet.loadCells('A1:O120')

  const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  // Ключевые строки-секции (группы верхнего уровня)
  const HEADERS = ['доходы', 'расходы']
  const TOTALS = ['итого', 'чистый доход']

  type RawRow = { row: number; label: string; values: number[]; total: number }
  const rawRows: RawRow[] = []

  for (let r = 1; r < 120; r++) {
    const label = String(sheet.getCell(r, 0).formattedValue || '').trim()
    if (!label) continue

    const values: number[] = []
    for (let c = 1; c <= 12; c++) {
      values.push(parseRuNumber(String(sheet.getCell(r, c).formattedValue || '0')))
    }
    // Колонка N (13) = Итого (yearly sum)
    const total = parseRuNumber(String(sheet.getCell(r, 13).formattedValue || '0'))

    rawRows.push({ row: r, label, values, total })
  }

  // Собираем иерархию: строки между группами = подкатегории
  // Группы верхнего уровня определяются по наличию подкатегорий (строки 17-39 под "Поставщик" и т.д.)
  // Проще: читаем ВСЕ строки и группируем по секциям "Доходы" / "Расходы"

  const categories: DdsCategory[] = []
  let currentSection: DdsCategory | null = null
  let currentGroup: DdsCategory | null = null

  for (const raw of rawRows) {
    const lbl = raw.label.toLowerCase()

    // Секция: Доходы / Расходы
    if (HEADERS.includes(lbl)) {
      currentSection = { label: raw.label, values: raw.values, total: raw.total, children: [], isHeader: true }
      categories.push(currentSection)
      currentGroup = null
      continue
    }

    // Итого / Чистый доход
    if (TOTALS.some((t) => lbl.startsWith(t))) {
      categories.push({ label: raw.label, values: raw.values, total: raw.total, children: [], isHeader: true })
      currentGroup = null
      continue
    }

    if (!currentSection) continue

    // Определяем: если total > 0 и есть подстроки после — это группа
    // Простая эвристика: строка является группой если её label совпадает с категорией из справочника
    // Или если следующая строка имеет меньший уровень группировки
    // Лучшая эвристика: строки из группировки в таблице (17, 40, 53, 54, 69, 72, 90, 97, 105, 114)
    // Эти строки = категории верхнего уровня. Всё между ними = подкатегории.

    const hasNonZero = raw.values.some((v) => v !== 0) || raw.total !== 0

    // Проверяем, является ли строка "групповой" (категория верхнего уровня)
    // Если она совпадает с одной из категорий из справочника, значит это группа
    const isKnownGroup = /^(поставщик|поставщик_1|налоги|хоз\.рас|финансовые операции|маркетинг|транспортные расходы|фот|вывод средств|пополнение|услуги)/i.test(raw.label)

    if (isKnownGroup && hasNonZero) {
      currentGroup = { label: raw.label, values: raw.values, total: raw.total, children: [], isHeader: false }
      currentSection.children.push(currentGroup)
    } else if (currentGroup && hasNonZero) {
      // Подкатегория
      currentGroup.children.push({ label: raw.label, values: raw.values, total: raw.total, children: [], isHeader: false })
    } else if (hasNonZero) {
      // Отдельная строка без группы
      currentSection.children.push({ label: raw.label, values: raw.values, total: raw.total, children: [], isHeader: false })
    }
  }

  return { categories, months: MONTHS_RU }
}

// ── Баланс счетов ──

export type AccountBalance = {
  account: string
  income: number
  expense: number
  balance: number
  lastDate: string
}

export const getAccountBalances = async (): Promise<AccountBalance[]> => {
  const sheet = await getSheet('Ежедневно')
  const rows = await sheet.getRows()

  const accounts: Record<string, { income: number; expense: number; lastDate: string }> = {}

  for (const r of rows) {
    const payType = (r.get('Тип оплаты') || '').trim()
    if (!payType) continue

    const opType = r.get('Тип операции') || ''
    const amount = parseRuNumber(r.get('Сумма') || '0')
    const date = r.get('Дата') || ''
    const isExpense = opType.toLowerCase().includes('расход')

    if (!accounts[payType]) accounts[payType] = { income: 0, expense: 0, lastDate: '' }
    if (isExpense) accounts[payType].expense += amount
    else accounts[payType].income += amount
    if (date) accounts[payType].lastDate = date
  }

  return Object.entries(accounts)
    .map(([account, data]) => ({
      account,
      income: data.income,
      expense: data.expense,
      balance: data.income - data.expense,
      lastDate: data.lastDate
    }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
}

// ── Финансовое положение ──

export type FinancialHealth = {
  income7d: number
  expense7d: number
  income30d: number
  expense30d: number
  avgDailyIncome7d: number
  avgDailyExpense7d: number
  avgDailyExpense30d: number
  burnRate: number // дней до исчерпания при текущих расходах
  totalBalance: number
  trend: 'positive' | 'warning' | 'critical'
  upcomingExpenses: { category: string; avgMonthly: number }[] // топ категорий расходов
  monthlyNet: { month: string; net: number }[] // последние 6 месяцев
}

export const getFinancialHealth = async (tz: string): Promise<FinancialHealth> => {
  const sheet = await getSheet('Ежедневно')
  const rows = await sheet.getRows()

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  let income7d = 0, expense7d = 0, income30d = 0, expense30d = 0
  let totalIncome = 0, totalExpense = 0

  const monthlyData: Record<string, { income: number; expense: number }> = {}
  const categoryExpenses: Record<string, number[]> = {} // category -> monthly amounts

  for (const r of rows) {
    const dateStr = r.get('Дата') || ''
    const parsed = parseDdMmYyyy(dateStr)
    if (!parsed) continue

    const d = new Date(parsed.year, parsed.month - 1, parsed.day)
    const opType = r.get('Тип операции') || ''
    const amount = parseRuNumber(r.get('Сумма') || '0')
    const category = r.get('Категория') || ''
    const isExpense = opType.toLowerCase().includes('расход')

    if (isExpense) totalExpense += amount
    else totalIncome += amount

    if (d >= sevenDaysAgo) {
      if (isExpense) expense7d += amount
      else income7d += amount
    }
    if (d >= thirtyDaysAgo) {
      if (isExpense) expense30d += amount
      else income30d += amount
    }

    // Месячные данные
    const mKey = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`
    if (!monthlyData[mKey]) monthlyData[mKey] = { income: 0, expense: 0 }
    if (isExpense) monthlyData[mKey].expense += amount
    else monthlyData[mKey].income += amount

    // Расходы по категориям за последние 3 месяца
    if (isExpense && d >= new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) && category) {
      if (!categoryExpenses[category]) categoryExpenses[category] = []
      categoryExpenses[category].push(amount)
    }
  }

  const totalBalance = totalIncome - totalExpense
  const avgDailyIncome7d = income7d / 7
  const avgDailyExpense7d = expense7d / 7
  const avgDailyExpense30d = expense30d / 30

  // Burn rate: сколько дней проживём при текущих расходах
  const burnRate = avgDailyExpense30d > 0 && totalBalance > 0
    ? Math.round(totalBalance / avgDailyExpense30d)
    : totalBalance <= 0 ? 0 : 999

  // Тренд — учитываем баланс, burn rate и 30-дневную динамику
  let trend: 'positive' | 'warning' | 'critical' = 'positive'
  const net30d = income30d - expense30d

  if (totalBalance <= 0) trend = 'critical'
  else if (burnRate < 14) trend = 'critical'
  else if (burnRate < 30 || net30d < 0) trend = 'warning'
  else if (expense30d > income30d * 1.2) trend = 'warning'

  // Топ категорий расходов
  const upcomingExpenses = Object.entries(categoryExpenses)
    .map(([category, amounts]) => ({
      category,
      avgMonthly: amounts.reduce((a, b) => a + b, 0) / 3
    }))
    .sort((a, b) => b.avgMonthly - a.avgMonthly)
    .slice(0, 5)

  // Последние 6 месяцев
  const sortedMonths = Object.keys(monthlyData).sort()
  const last6 = sortedMonths.slice(-6)
  const monthlyNet = last6.map((m) => ({
    month: m,
    net: monthlyData[m].income - monthlyData[m].expense
  }))

  return {
    income7d, expense7d, income30d, expense30d,
    avgDailyIncome7d, avgDailyExpense7d, avgDailyExpense30d,
    burnRate, totalBalance, trend,
    upcomingExpenses, monthlyNet
  }
}

// ── Проверка: есть ли записи за сегодня ──

export const hasTodayEntries = async (tz: string): Promise<boolean> => {
  const sheet = await getSheet('Ежедневно')
  const rows = await sheet.getRows()

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
  const todayStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`

  return rows.some((r) => (r.get('Дата') || '') === todayStr)
}

// ── Хелперы ──

export const parseRuNumber = (s: string): number => {
  const cleaned = String(s).replace(/\s/g, '').replace(',', '.')
  return Number(cleaned) || 0
}

const parseDdMmYyyy = (s: string): { day: number; month: number; year: number } | null => {
  const m = String(s).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) }
}
