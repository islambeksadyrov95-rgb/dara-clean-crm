import { InlineKeyboard } from 'grammy'

const chunk = <T>(items: T[], perRow: number) => {
  if (perRow <= 0) return [items]
  const result: T[][] = []
  for (let i = 0; i < items.length; i += perRow) result.push(items.slice(i, i + perRow))
  return result
}

export const buildInlineKeyboard = (items: string[], dataPrefix: string, perRow = 2) => {
  const kb = new InlineKeyboard()
  const rows = chunk(items, perRow)
  for (const row of rows) {
    for (const label of row) kb.text(label, `${dataPrefix}:${label}`)
    kb.row()
  }
  return kb
}

export const formatMoney = (amount: number) => {
  const rounded = Math.round(amount * 100) / 100
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(rounded)
}

export const parseAmount = (text: string) => {
  const normalized = text.replace(/\s/g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  if (value <= 0) return null
  return value
}

export const isoToday = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

