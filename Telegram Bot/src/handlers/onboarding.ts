import { InlineKeyboard } from 'grammy'
import type { BotContext } from '../types.js'
import { sendMainMenu } from '../shared.js'

export const ONBOARDING_STEPS = [
  {
    text: `\u{1F44B} Добро пожаловать в Dara Clean Bot!\n\nЯ помогаю вести финансовый учёт компании прямо в Telegram. Все данные сохраняются в Google Таблицу автоматически.\n\nДавайте познакомлю вас с основными функциями.`,
    btn: 'Начнём! \u{27A1}'
  },
  {
    text: `\u{1F4DD} Добавить операцию\n\nГлавная кнопка. Позволяет записать расход или приход:\n\n1. Выбираете дату (сегодня или из календаря)\n2. Тип операции (Расход / Приход)\n3. Способ оплаты (Наличные, Kaspi Gold/Pay...)\n4. Вводите сумму\n5. Выбираете категорию и статью\n6. Добавляете комментарий\n\nВсё через кнопки — быстро и без ошибок.`,
    btn: 'Дальше \u{27A1}'
  },
  {
    text: `\u{1F4CB} Последние — показывает 10 последних операций.\n\n\u{1F4CA} Статистика — итоги по категориям за текущий месяц. Видно куда уходят деньги.`,
    btn: 'Дальше \u{27A1}'
  },
  {
    text: `\u{1F4B5} Баланс счетов\n\nПоказывает сколько денег на каждом счёте (Наличные, Kaspi и др.) — приход, расход, остаток.\n\n\u{1F4C8} ДДС\n\nДвижение Денежных Средств — отчёт по месяцам за год. Можно переключать года.`,
    btn: 'Дальше \u{27A1}'
  },
  {
    text: `\u{1F3AF} Фин. положение\n\nАналитика на основе ваших данных:\n\n\u{2022} Статус: стабильное / внимание / критическое\n\u{2022} Средний доход и расход за 7 и 30 дней\n\u{2022} Запас прочности (дней)\n\u{2022} Топ расходов и динамика по месяцам\n\u{2022} Рекомендации`,
    btn: 'Дальше \u{27A1}'
  },
  {
    text: `\u{1F465} Доступ\n\nУправление пользователями бота:\n\n\u{2022} Одобрять/отклонять запросы\n\u{2022} Добавлять по @username\n\u{2022} Генерировать одноразовые ссылки-приглашения\n\u{2022} Удалять пользователей\n\n\u{1F504} Обновить справочники — если в таблице изменились категории/статьи.`,
    btn: 'Дальше \u{27A1}'
  },
  {
    text: `\u{1F514} Вечернее напоминание\n\nКаждый день в 20:30 бот проверяет, есть ли записи за сегодня. Если нет — напомнит заполнить.\n\n\u{2705} Вы готовы! Нажмите кнопку ниже чтобы начать работу.`,
    btn: '\u{1F680} Начать работу!'
  }
]

export const sendOnboarding = async (ctx: BotContext, step: number) => {
  const s = ONBOARDING_STEPS[step]
  const isLast = step === ONBOARDING_STEPS.length - 1
  const kb = new InlineKeyboard()

  if (isLast) {
    kb.text(s.btn, 'onboard_done')
  } else {
    kb.text(s.btn, `onboard_next:${step + 1}`)
  }

  if (step > 0) kb.text('\u{25C0} Назад', `onboard_next:${step - 1}`)

  if (step === 0) {
    await ctx.reply(s.text, { reply_markup: kb })
  } else {
    try {
      await ctx.editMessageText(s.text, { reply_markup: kb })
    } catch {
      await ctx.reply(s.text, { reply_markup: kb })
    }
  }
}

export const registerOnboarding = (bot: import('grammy').Bot<BotContext>) => {
  bot.callbackQuery(/^onboard_next:(\d+)$/, async (ctx) => {
    const step = Number(ctx.match![1])
    await ctx.answerCallbackQuery()
    await sendOnboarding(ctx, step)
  })

  bot.callbackQuery('onboard_done', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.deleteMessage()
    await sendMainMenu(ctx, '\u{2705} Онбординг завершён! Используйте кнопки ниже.')
  })
}
