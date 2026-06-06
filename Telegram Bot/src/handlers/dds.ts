import { InlineKeyboard } from 'grammy'
import type { BotContext } from '../types.js'
import { env } from '../env.js'
import * as sheets from '../sheetsClient.js'
import { formatMoney } from '../ui.js'
import { withLoading, sendMainMenu, sendWithInline, deletePrev } from '../shared.js'

const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

const SEP = '\u{2500}'.repeat(25)

type DdsData = Awaited<ReturnType<typeof sheets.getDds>>

const findSection = (dds: DdsData, name: string) =>
  dds.categories.find((c) => c.label.toLowerCase().includes(name))

const ddsOverviewKb = (year: number) => {
  const kb = new InlineKeyboard()
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const m = row * 4 + col
      kb.text(MONTHS_SHORT[m], `dds_m:${year}:${m}`)
    }
    kb.row()
  }
  kb.text('Q1', `dds_q:${year}:1`)
    .text('Q2', `dds_q:${year}:2`)
    .text('Q3', `dds_q:${year}:3`)
    .text('Q4', `dds_q:${year}:4`)
    .row()
  kb.text(`\u{25C0} ${year - 1}`, `dds_y:${year - 1}`)
    .text(`\u{1F4C5} ${year}`, `dds_y:${year}`)
    .text(`${year + 1} \u{25B6}`, `dds_y:${year + 1}`)
  return kb
}

const ddsOverviewText = (dds: DdsData, year: number): string => {
  const incomeSection = findSection(dds, 'доходы')
  const expenseSection = findSection(dds, 'расходы')
  const netSection = findSection(dds, 'чистый доход')

  const lines: string[] = [`\u{1F4C8} ДДС ${year}`, SEP]

  for (let i = 0; i < 12; i++) {
    const inc = incomeSection?.children.reduce((s, c) => s + c.values[i], 0) ?? 0
    const exp = expenseSection?.children.reduce((s, c) => s + c.values[i], 0) ?? 0
    const net = netSection?.values[i] ?? (inc - exp)

    if (inc === 0 && exp === 0) continue

    const netIcon = net >= 0 ? '\u{1F7E2}' : '\u{1F534}'
    lines.push('')
    lines.push(`\u{1F4C5} ${MONTHS_FULL[i]}`)
    lines.push(`   \u{1F7E2} Доход:  +${formatMoney(inc)}`)
    lines.push(`   \u{1F534} Расход: -${formatMoney(exp)}`)
    lines.push(`   ${netIcon} Итого:  ${formatMoney(net)}`)
  }

  let totalInc = 0
  let totalExp = 0
  for (let i = 0; i < 12; i++) {
    totalInc += incomeSection?.children.reduce((s, c) => s + c.values[i], 0) ?? 0
    totalExp += expenseSection?.children.reduce((s, c) => s + c.values[i], 0) ?? 0
  }
  const totalNet = totalInc - totalExp
  const totalIcon = totalNet >= 0 ? '\u{1F7E2}' : '\u{1F534}'

  lines.push('')
  lines.push(SEP)
  lines.push(`\u{1F4CA} ИТОГО ЗА ${year}`)
  lines.push(`   \u{1F7E2} Доход:  +${formatMoney(totalInc)}`)
  lines.push(`   \u{1F534} Расход: -${formatMoney(totalExp)}`)
  lines.push(`   ${totalIcon} Итого:  ${formatMoney(totalNet)}`)
  lines.push('')
  lines.push(`\u{1F447} Нажмите на месяц или квартал`)

  return lines.join('\n')
}

const ddsMonthDetail = (dds: DdsData, year: number, monthIdx: number): string => {
  const incomeSection = findSection(dds, 'доходы')
  const expenseSection = findSection(dds, 'расходы')

  const lines: string[] = [`\u{1F4C8} ДДС \u{2014} ${MONTHS_FULL[monthIdx]} ${year}`, SEP]

  let totalInc = 0
  if (incomeSection?.children.length) {
    lines.push('')
    lines.push(`\u{1F7E2} ДОХОДЫ`)
    for (const group of incomeSection.children) {
      const val = group.values[monthIdx]
      if (val === 0) continue
      totalInc += val
      lines.push(`   ${group.label}: ${formatMoney(val)}`)
      for (const sub of group.children) {
        const sv = sub.values[monthIdx]
        if (sv === 0) continue
        lines.push(`      \u{2514} ${sub.label}: ${formatMoney(sv)}`)
      }
    }
  }

  let totalExp = 0
  if (expenseSection?.children.length) {
    lines.push('')
    lines.push(`\u{1F534} РАСХОДЫ`)
    for (const group of expenseSection.children) {
      const val = group.values[monthIdx]
      if (val === 0) continue
      totalExp += val
      lines.push(`   ${group.label}: ${formatMoney(val)}`)
      for (const sub of group.children) {
        const sv = sub.values[monthIdx]
        if (sv === 0) continue
        lines.push(`      \u{2514} ${sub.label}: ${formatMoney(sv)}`)
      }
    }
  }

  const net = totalInc - totalExp
  const netIcon = net >= 0 ? '\u{1F7E2}' : '\u{1F534}'
  lines.push('')
  lines.push(SEP)
  lines.push(`\u{1F7E2} Доход:  +${formatMoney(totalInc)}`)
  lines.push(`\u{1F534} Расход: -${formatMoney(totalExp)}`)
  lines.push(`${netIcon} Итого:  ${formatMoney(net)}`)

  return lines.join('\n')
}

const ddsQuarterDetail = (dds: DdsData, year: number, quarter: number): string => {
  const startMonth = (quarter - 1) * 3
  const monthsIdx = [startMonth, startMonth + 1, startMonth + 2]
  const qMonths = monthsIdx.map((i) => MONTHS_SHORT[i]).join(' + ')

  const incomeSection = findSection(dds, 'доходы')
  const expenseSection = findSection(dds, 'расходы')

  const lines: string[] = [`\u{1F4C8} ДДС \u{2014} Q${quarter} ${year} (${qMonths})`, SEP]

  let totalInc = 0
  if (incomeSection?.children.length) {
    lines.push('')
    lines.push(`\u{1F7E2} ДОХОДЫ`)
    for (const group of incomeSection.children) {
      const val = monthsIdx.reduce((s, i) => s + group.values[i], 0)
      if (val === 0) continue
      totalInc += val
      lines.push(`   ${group.label}: ${formatMoney(val)}`)
    }
    lines.push('')
  }

  let totalExp = 0
  if (expenseSection?.children.length) {
    lines.push('')
    lines.push(`\u{1F534} РАСХОДЫ`)
    for (const group of expenseSection.children) {
      const val = monthsIdx.reduce((s, i) => s + group.values[i], 0)
      if (val === 0) continue
      totalExp += val
      lines.push(`   ${group.label}: ${formatMoney(val)}`)
    }
  }

  const net = totalInc - totalExp
  const netIcon = net >= 0 ? '\u{1F7E2}' : '\u{1F534}'
  lines.push('')
  lines.push(SEP)
  lines.push(`\u{1F7E2} Доход:  +${formatMoney(totalInc)}`)
  lines.push(`\u{1F534} Расход: -${formatMoney(totalExp)}`)
  lines.push(`${netIcon} Итого Q${quarter}: ${formatMoney(net)}`)

  return lines.join('\n')
}

export const registerDds = (bot: import('grammy').Bot<BotContext>) => {
  bot.hears('\u{1F4C8} ДДС', async (ctx) => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: env.TZ }))
    const year = now.getFullYear()

    await withLoading(ctx, 'Загружаю ДДС...', async () => {
      try {
        const dds = await sheets.getDds(year)
        await deletePrev(ctx)
        await sendWithInline(ctx, ddsOverviewText(dds, year), ddsOverviewKb(year))
      } catch (e: any) {
        await sendMainMenu(ctx, `\u{274C} ${e.message}`)
      }
    })
  })

  bot.callbackQuery(/^dds_y:(\d+)$/, async (ctx) => {
    const year = Number(ctx.match![1])
    await ctx.answerCallbackQuery()
    try {
      const dds = await sheets.getDds(year)
      await ctx.editMessageText(ddsOverviewText(dds, year), { reply_markup: ddsOverviewKb(year) })
    } catch {
      await ctx.editMessageText(`\u{274C} Нет данных за ${year}`)
    }
  })

  bot.callbackQuery(/^dds_m:(\d+):(\d+)$/, async (ctx) => {
    const year = Number(ctx.match![1])
    const monthIdx = Number(ctx.match![2])
    await ctx.answerCallbackQuery()
    try {
      const dds = await sheets.getDds(year)
      const backKb = new InlineKeyboard().text('\u{25C0} Назад к обзору', `dds_y:${year}`)
      await ctx.editMessageText(ddsMonthDetail(dds, year, monthIdx), { reply_markup: backKb })
    } catch {
      await ctx.editMessageText(`\u{274C} Нет данных`)
    }
  })

  bot.callbackQuery(/^dds_q:(\d+):(\d+)$/, async (ctx) => {
    const year = Number(ctx.match![1])
    const quarter = Number(ctx.match![2])
    await ctx.answerCallbackQuery()
    try {
      const dds = await sheets.getDds(year)
      const backKb = new InlineKeyboard().text('\u{25C0} Назад к обзору', `dds_y:${year}`)
      await ctx.editMessageText(ddsQuarterDetail(dds, year, quarter), { reply_markup: backKb })
    } catch {
      await ctx.editMessageText(`\u{274C} Нет данных`)
    }
  })
}
