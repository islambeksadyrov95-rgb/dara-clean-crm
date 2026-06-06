import { InlineKeyboard } from 'grammy'
import type { BotContext } from '../types.js'
import { env } from '../env.js'
import * as sheets from '../sheetsClient.js'
import { formatMoney } from '../ui.js'
import { withLoading, sendMainMenu, sendWithInline, sendResult } from '../shared.js'

export const registerBalance = (bot: import('grammy').Bot<BotContext>) => {
  bot.hears('\u{1F4B5} Баланс счетов', async (ctx) => {
    await withLoading(ctx, 'Считаю балансы...', async () => {
      const balances = await sheets.getAccountBalances()

      if (!balances.length) {
        await sendMainMenu(ctx, 'Нет данных по счетам.')
        return
      }

      const hasToday = await sheets.hasTodayEntries(env.TZ)

      let totalBalance = 0
      const lines: string[] = ['\u{1F4B5} Баланс счетов\n']

      if (!hasToday) {
        lines.push('\u{26A0} Сегодня нет записей! Баланс на последний день с операциями.')
        lines.push('Заполните данные для актуальной информации.\n')
      }

      for (const b of balances) {
        const icon = b.balance >= 0 ? '\u{1F7E2}' : '\u{1F534}'
        lines.push(`${icon} ${b.account}`)
        lines.push(`   Приход: +${formatMoney(b.income)}`)
        lines.push(`   Расход: -${formatMoney(b.expense)}`)
        lines.push(`   Остаток: ${formatMoney(b.balance)}\n`)
        totalBalance += b.balance
      }

      const totalIcon = totalBalance >= 0 ? '\u{1F7E2}' : '\u{1F534}'
      lines.push(`${totalIcon} ОБЩИЙ БАЛАНС: ${formatMoney(totalBalance)}`)
      lines.push(`\n\u{1F4C5} Последняя операция: ${balances[0]?.lastDate || '—'}`)

      if (!hasToday) {
        const kb = new InlineKeyboard().text('\u{1F4DD} Заполнить за сегодня', 'reminder_add')
        await sendWithInline(ctx, lines.join('\n'), kb)
      } else {
        await sendResult(ctx, lines.join('\n'))
      }
    })
  })

  bot.hears('\u{1F3AF} Фин. положение', async (ctx) => {
    await withLoading(ctx, 'Анализирую финансы...', async () => {
      const h = await sheets.getFinancialHealth(env.TZ)

      const trendIcon = h.trend === 'positive' ? '\u{1F7E2}' : h.trend === 'warning' ? '\u{1F7E1}' : '\u{1F534}'
      const trendText = h.trend === 'positive' ? 'Стабильное' : h.trend === 'warning' ? 'Требует внимания' : 'Критическое'

      const net30 = h.income30d - h.expense30d
      const net30Icon = net30 >= 0 ? '\u{1F7E2}' : '\u{1F534}'
      const balIcon = h.totalBalance >= 0 ? '\u{1F7E2}' : '\u{1F534}'

      const lines: string[] = [
        `\u{1F3AF} Финансовое положение\n`,
        `${trendIcon} Статус: ${trendText}\n`,
        `\u{1F4C5} За последние 30 дней:`,
        `   \u{1F7E2} Доход: +${formatMoney(h.income30d)}`,
        `   \u{1F534} Расход: -${formatMoney(h.expense30d)}`,
        `   ${net30Icon} Разница: ${formatMoney(net30)}\n`,
        `${balIcon} Общий баланс: ${formatMoney(h.totalBalance)}`,
      ]

      if (h.burnRate > 0 && h.burnRate < 999) {
        lines.push(`\u{23F3} Запас прочности: ${h.burnRate} дней`)
      } else if (h.totalBalance <= 0) {
        lines.push(`\u{1F6A8} Кассовый разрыв!`)
      }
      lines.push('')

      if (h.upcomingExpenses.length) {
        lines.push(`\u{1F4CB} Топ-5 расходов (за 3 мес.):`)
        for (const e of h.upcomingExpenses) {
          lines.push(`   \u{1F534} ${e.category}: ${formatMoney(e.avgMonthly)}/мес`)
        }
        lines.push('')
      }

      if (h.monthlyNet.length) {
        lines.push(`\u{1F4C8} Динамика по месяцам:`)
        for (const m of h.monthlyNet) {
          const icon = m.net >= 0 ? '\u{1F7E2}' : '\u{1F534}'
          lines.push(`   ${icon} ${m.month}: ${formatMoney(m.net)}`)
        }
      }

      lines.push('\n\u{1F4A1} Рекомендации:')
      if (h.trend === 'critical') {
        lines.push('   \u{1F6A8} Кассовый разрыв или его угроза. Необходимо срочно увеличить выручку или сократить расходы.')
      } else if (h.trend === 'warning') {
        lines.push('   \u{26A0} Расходы приближаются к доходам. Контролируйте крупные статьи расходов.')
      } else {
        lines.push('   \u{2705} Финансы в норме. Поддерживайте текущий уровень контроля.')
      }

      if (h.burnRate < 30 && h.burnRate > 0) {
        lines.push(`   \u{1F6A8} При текущих расходах запас кончится через ${h.burnRate} дней!`)
      }

      await sendResult(ctx, lines.join('\n'))
    })
  })
}
