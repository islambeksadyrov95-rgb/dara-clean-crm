import { InlineKeyboard } from 'grammy'
import type { BotContext } from '../types.js'
import { env } from '../env.js'
import * as sheets from '../sheetsClient.js'
import * as access from '../access.js'

const REMINDER_MESSAGES = [
  '\u{1F4CA} Компании, которые не ведут ежедневный учёт, теряют до 30% прибыли из-за незамеченных расходов. Не откладывайте — внесите данные за сегодня!',
  '\u{1F4B0} 90% успешных компаний ведут финансовый учёт ежедневно. Заполните данные за сегодня — это займёт пару минут.',
  '\u{26A0} Без ежедневного учёта невозможно контролировать cash flow. Через месяц пробелы в данных превращаются в финансовые дыры.',
  '\u{1F4C8} Дисциплина в учёте = контроль над бизнесом. Компании без учёта в 3 раза чаще сталкиваются с кассовыми разрывами.',
  '\u{23F0} Вечер — лучшее время подвести итоги дня. Внесите расходы/доходы, пока всё свежо в памяти!',
  '\u{1F6A8} Финансовый хаос начинается с "завтра запишу". Не откладывайте — внесите данные прямо сейчас.',
  '\u{1F4DD} Регулярный учёт — основа финансового здоровья. 5 минут сейчас сэкономят часы разборов в конце месяца.'
]

export const scheduleReminder = (bot: import('grammy').Bot<BotContext>) => {
  const check = async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: env.TZ }))
    const hour = now.getHours()
    const minute = now.getMinutes()

    if (hour === 20 && minute >= 30 && minute < 35) {
      const hasEntries = await sheets.hasTodayEntries(env.TZ)

      if (!hasEntries) {
        const msg = REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)]
        const approvedUsers = await access.getApprovedUsers()
        const kb = new InlineKeyboard().text('\u{1F4DD} Добавить операцию', 'reminder_add')

        for (const user of approvedUsers) {
          if (user.chatId > 0) {
            try {
              await bot.api.sendMessage(user.chatId, `\u{1F514} Напоминание\n\n${msg}`, { reply_markup: kb })
            } catch { /* ignore */ }
          }
        }
      }
    }
  }

  setInterval(check, 5 * 60 * 1000)
}
