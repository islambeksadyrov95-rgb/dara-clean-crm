import type { BotContext } from '../types.js'
import { env } from '../env.js'
import * as sheets from '../sheetsClient.js'
import { formatMoney } from '../ui.js'
import { mainMenu, sendMainMenu, withLoading } from '../shared.js'

const MONTHS_RU = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export const handleLast = async (ctx: BotContext) => {
  const result = await sheets.listEntries(10)
  const entries = result.entries ?? []
  if (!entries.length) {
    await sendMainMenu(ctx, 'Пока нет операций.')
    return
  }

  const lines = entries.map((e) => {
    const icon = e.operationType.toLowerCase().includes('расход') ? '\u{1F534}' : '\u{1F7E2}'
    const base = `${icon} ${e.date}  ${formatMoney(e.amount)}\n${e.category} / ${e.article}`
    const extra = [e.paymentType, e.comment].filter(Boolean).join(' \u{00B7} ')
    return extra.length ? `${base}\n${extra}` : base
  })

  await sendMainMenu(ctx, `\u{1F4CB} Последние ${entries.length} операций:\n\n${lines.join('\n\n')}`)
}

export const handleStats = async (ctx: BotContext) => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: env.TZ }))
  let month = now.getMonth() + 1
  let year = now.getFullYear()

  let result = await sheets.monthStats(month, year)
  let pairs = Object.entries(result.totalsByCategory).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))

  let notice = ''
  if (!pairs.length) {
    month--
    if (month < 1) { month = 12; year-- }
    result = await sheets.monthStats(month, year)
    pairs = Object.entries(result.totalsByCategory).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    notice = '\u{26A0} За текущий месяц нет записей. Показаны данные за предыдущий.\n\n'
  }

  if (!pairs.length) {
    await sendMainMenu(ctx, `\u{1F4CA} Статистика\n\nНет данных за последние месяцы.`)
    return
  }

  let totalExpense = 0
  let totalIncome = 0
  const expenseLines: string[] = []
  const incomeLines: string[] = []

  for (const [cat, total] of pairs) {
    if (total < 0) {
      totalExpense += total
      expenseLines.push(`   \u{1F534} ${cat}: ${formatMoney(Math.abs(total))}`)
    } else {
      totalIncome += total
      incomeLines.push(`   \u{1F7E2} ${cat}: ${formatMoney(total)}`)
    }
  }

  const lines: string[] = [`\u{1F4CA} Статистика за ${MONTHS_RU[month]} ${year}\n`]
  if (notice) lines.push(notice)

  if (incomeLines.length) {
    lines.push(`\u{1F7E2} ДОХОДЫ: +${formatMoney(totalIncome)}`)
    lines.push(...incomeLines)
    lines.push('')
  }

  if (expenseLines.length) {
    lines.push(`\u{1F534} РАСХОДЫ: -${formatMoney(Math.abs(totalExpense))}`)
    lines.push(...expenseLines)
    lines.push('')
  }

  const net = totalIncome + totalExpense
  const netIcon = net >= 0 ? '\u{1F7E2}' : '\u{1F534}'
  lines.push(`${netIcon} ИТОГО: ${formatMoney(net)}`)

  await ctx.reply(lines.join('\n'), { reply_markup: mainMenu })
}

export const registerStats = (bot: import('grammy').Bot<BotContext>) => {
  bot.hears('\u{1F4CB} Последние', async (ctx) => {
    if (ctx.chat.id < 0) return
    await withLoading(ctx, 'Загружаю последние операции...', () => handleLast(ctx))
  })

  bot.hears('\u{1F4CA} Статистика', async (ctx) => {
    if (ctx.chat.id < 0) return
    await withLoading(ctx, 'Считаю статистику...', () => handleStats(ctx))
  })
}
