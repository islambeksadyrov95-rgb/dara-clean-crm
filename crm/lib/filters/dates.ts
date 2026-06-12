import type { DatePreset, RangeValue } from './types'

// Дата-хелперы фильтров. Все «дни» считаются в часовом поясе Алматы (UTC+5, без DST):
// «за 30 дней» для менеджера — это 30 алматинских суток, не UTC.

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

function almatyDateParts(msOffsetFromNow = 0): { y: number; m: number; d: number } {
  const d = new Date(Date.now() + ALMATY_OFFSET_MS + msOffsetFromNow)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Сегодня в Алматы, YYYY-MM-DD. */
export function todayAlmaty(): string {
  const { y, m, d } = almatyDateParts()
  return toIso(y, m, d)
}

/** Дата N дней назад в Алматы, YYYY-MM-DD. */
export function daysAgoAlmaty(days: number): string {
  const { y, m, d } = almatyDateParts(-days * 86_400_000)
  return toIso(y, m, d)
}

function presetRange(preset: DatePreset): { from: string; to: string } {
  const today = todayAlmaty()
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'last7':
      return { from: daysAgoAlmaty(7), to: today }
    case 'last30':
      return { from: daysAgoAlmaty(30), to: today }
    case 'last90':
      return { from: daysAgoAlmaty(90), to: today }
    case 'thisMonth': {
      const { y, m } = almatyDateParts()
      return { from: toIso(y, m, 1), to: today }
    }
    case 'lastMonth': {
      const { y, m } = almatyDateParts()
      const prevY = m === 1 ? y - 1 : y
      const prevM = m === 1 ? 12 : m - 1
      const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate()
      return { from: toIso(prevY, prevM, 1), to: toIso(prevY, prevM, lastDay) }
    }
  }
}

/**
 * Разрешает значение date-range в абсолютные YYYY-MM-DD.
 * Пресет относительный: сохранённый фильтр «за 30 дней» завтра даёт правильное окно.
 */
export function resolveDateRange(value: RangeValue): { from?: string; to?: string } {
  if (value.preset) return presetRange(value.preset)
  return { from: value.from || undefined, to: value.to || undefined }
}
