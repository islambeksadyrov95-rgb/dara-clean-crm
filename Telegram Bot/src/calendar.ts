import { InlineKeyboard } from 'grammy'

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// ── Режим 1: Дни месяца ──

export const buildCalendarKb = (year: number, month: number): InlineKeyboard => {
  const kb = new InlineKeyboard()

  // Навигация: < Месяц Год >
  kb.text('\u{25C0}', `cal_nav:${year}:${month - 1}`)
    .text(MONTHS_RU[month - 1], `cal_months:${year}`)
    .text(String(year), `cal_years:${year}`)
    .text('\u{25B6}', `cal_nav:${year}:${month + 1}`)
    .row()

  // Дни недели
  for (const d of DAYS_RU) kb.text(d, 'cal_noop')
  kb.row()

  // Дни месяца
  const firstDay = new Date(year, month - 1, 1)
  let dayOfWeek = firstDay.getDay()
  dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1

  const daysInMonth = new Date(year, month, 0).getDate()

  for (let i = 0; i < dayOfWeek; i++) kb.text(' ', 'cal_noop')

  let col = dayOfWeek
  for (let day = 1; day <= daysInMonth; day++) {
    const dd = String(day).padStart(2, '0')
    const mm = String(month).padStart(2, '0')
    kb.text(String(day), `cal_day:${dd}.${mm}.${year}`)
    col++
    if (col === 7) { kb.row(); col = 0 }
  }

  if (col > 0) {
    for (let i = col; i < 7; i++) kb.text(' ', 'cal_noop')
    kb.row()
  }

  return kb
}

// ── Режим 2: Выбор месяца ──

export const buildMonthPickerKb = (year: number): InlineKeyboard => {
  const kb = new InlineKeyboard()

  // Заголовок с навигацией по годам
  kb.text('\u{25C0}', `cal_months:${year - 1}`)
    .text(String(year), `cal_years:${year}`)
    .text('\u{25B6}', `cal_months:${year + 1}`)
    .row()

  // 4 ряда по 3 месяца
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const m = row * 3 + col
      kb.text(MONTHS_SHORT[m], `cal_pick_month:${year}:${m + 1}`)
    }
    kb.row()
  }

  return kb
}

// ── Режим 3: Выбор года ──

export const buildYearPickerKb = (centerYear: number): InlineKeyboard => {
  const kb = new InlineKeyboard()

  const startYear = centerYear - 5
  const endYear = centerYear + 5

  // Навигация
  kb.text('\u{25C0}', `cal_years:${centerYear - 11}`)
    .text(`${startYear} — ${endYear}`, 'cal_noop')
    .text('\u{25B6}', `cal_years:${centerYear + 11}`)
    .row()

  // 4 ряда по 3 года
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const y = startYear + row * 3 + col
      if (y <= endYear) {
        kb.text(String(y), `cal_pick_year:${y}`)
      } else {
        kb.text(' ', 'cal_noop')
      }
    }
    kb.row()
  }

  return kb
}

export const normalizeCalNav = (year: number, month: number): { year: number; month: number } => {
  if (month < 1) return { year: year - 1, month: 12 }
  if (month > 12) return { year: year + 1, month: 1 }
  return { year, month }
}
