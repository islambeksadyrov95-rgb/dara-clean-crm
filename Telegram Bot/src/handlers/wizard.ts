import { InlineKeyboard } from 'grammy'
import { createConversation } from '@grammyjs/conversations'
import type { Conversation } from '@grammyjs/conversations'
import type { BotContext } from '../types.js'
import { buildCalendarKb, buildMonthPickerKb, buildYearPickerKb, normalizeCalNav } from '../calendar.js'
import { formatMoney, parseAmount } from '../ui.js'
import { getDict } from '../dict.js'
import { env } from '../env.js'
import { todayDdMmYyyy } from '../shared.js'
import * as sheets from '../sheetsClient.js'

type BotConversation = Conversation<BotContext, BotContext>

const STEPS = ['\u{1F4C5} Дата', '\u{1F4CC} Тип', '\u{1F4B3} Оплата', '\u{1F4B0} Сумма', '\u{1F4C1} Категория', '\u{1F4C4} Статья', '\u{1F4AC} Коммент']

const progressBar = (stepIdx: number) =>
  STEPS.map((l, i) => {
    if (i < stepIdx) return '\u{2705} ' + l
    if (i === stepIdx) return '\u{1F449} ' + l
    return '\u{2B1C} ' + l
  }).join('\n')

const filledLines = (data: Record<string, string | undefined>) => {
  const icons: Record<string, string> = {
    date: '\u{1F4C5}', operationType: '\u{1F4CC}', paymentType: '\u{1F4B3}',
    amount: '\u{1F4B0}', category: '\u{1F4C1}', article: '\u{1F4C4}', comment: '\u{1F4AC}'
  }
  return Object.entries(data)
    .filter(([, v]) => v)
    .map(([k, v]) => `${icons[k] || ''} ${v}`)
    .join('\n')
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

const buildKb = (items: string[], prefix: string, cols = 2) => {
  const kb = new InlineKeyboard()
  for (const row of chunk(items, cols)) {
    for (const item of row) kb.text(item, `${prefix}:${item}`)
    kb.row()
  }
  return kb
}

const addEntryConversation = async (conversation: BotConversation, ctx: BotContext) => {
  const dict = await conversation.external(() => getDict())
  const todayStr = await conversation.external(() => todayDdMmYyyy())

  // Шаг 0: Дата
  const dateChoiceKb = new InlineKeyboard()
    .text(`\u{1F4C5} Сегодня (${todayStr})`, 'date:today')
    .row()
    .text('\u{1F4C6} Выбрать дату', 'date:pick')

  await ctx.reply(`${progressBar(0)}\n\nКогда была операция?`, { reply_markup: dateChoiceKb })

  let date = todayStr
  const dateCb = await conversation.waitForCallbackQuery(/^date:/)
  const dateChoice = dateCb.callbackQuery.data.split(':')[1]
  await dateCb.answerCallbackQuery()

  if (dateChoice === 'pick') {
    const now = await conversation.external(() => {
      const d = new Date(new Date().toLocaleString('en-US', { timeZone: env.TZ }))
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })
    let calYear = now.year
    let calMonth = now.month

    await dateCb.editMessageText(`${progressBar(0)}\n\nВыберите дату:`, {
      reply_markup: buildCalendarKb(calYear, calMonth)
    })

    while (true) {
      const calCb = await conversation.waitForCallbackQuery(/^cal_/)
      const calData = calCb.callbackQuery.data

      if (calData === 'cal_noop') { await calCb.answerCallbackQuery(); continue }

      if (calData.startsWith('cal_nav:')) {
        const parts = calData.split(':')
        const nav = normalizeCalNav(Number(parts[1]), Number(parts[2]))
        calYear = nav.year; calMonth = nav.month
        await calCb.answerCallbackQuery()
        await calCb.editMessageText(`${progressBar(0)}\n\nВыберите дату:`, {
          reply_markup: buildCalendarKb(calYear, calMonth)
        })
        continue
      }

      if (calData.startsWith('cal_months:')) {
        const y = Number(calData.split(':')[1])
        calYear = y
        await calCb.answerCallbackQuery()
        await calCb.editMessageText(`${progressBar(0)}\n\nВыберите месяц:`, {
          reply_markup: buildMonthPickerKb(calYear)
        })
        continue
      }

      if (calData.startsWith('cal_years:')) {
        const y = Number(calData.split(':')[1])
        await calCb.answerCallbackQuery()
        await calCb.editMessageText(`${progressBar(0)}\n\nВыберите год:`, {
          reply_markup: buildYearPickerKb(y)
        })
        continue
      }

      if (calData.startsWith('cal_pick_month:')) {
        const parts = calData.split(':')
        calYear = Number(parts[1]); calMonth = Number(parts[2])
        await calCb.answerCallbackQuery()
        await calCb.editMessageText(`${progressBar(0)}\n\nВыберите дату:`, {
          reply_markup: buildCalendarKb(calYear, calMonth)
        })
        continue
      }

      if (calData.startsWith('cal_pick_year:')) {
        calYear = Number(calData.split(':')[1])
        await calCb.answerCallbackQuery()
        await calCb.editMessageText(`${progressBar(0)}\n\nВыберите месяц:`, {
          reply_markup: buildMonthPickerKb(calYear)
        })
        continue
      }

      if (calData.startsWith('cal_day:')) {
        date = calData.split(':')[1]
        await calCb.answerCallbackQuery()
        await calCb.editMessageText(
          `${progressBar(1)}\n\n${filledLines({ date })}\n\nВыберите тип операции:`,
          { reply_markup: buildKb(dict.operationTypes, 'op', 2) }
        )
        break
      }
      await calCb.answerCallbackQuery()
    }
  } else {
    await dateCb.editMessageText(
      `${progressBar(1)}\n\n${filledLines({ date })}\n\nВыберите тип операции:`,
      { reply_markup: buildKb(dict.operationTypes, 'op', 2) }
    )
  }

  // Шаг 1: Тип операции
  const opCb = await conversation.waitForCallbackQuery(/^op:/)
  const operationType = opCb.callbackQuery.data.split(':').slice(1).join(':')
  await opCb.answerCallbackQuery()

  // Шаг 2: Тип оплаты
  await opCb.editMessageText(
    `${progressBar(2)}\n\n${filledLines({ date, operationType })}\n\nВыберите тип оплаты:`,
    { reply_markup: buildKb(dict.paymentTypes, 'pay', 2) }
  )
  const payCb = await conversation.waitForCallbackQuery(/^pay:/)
  const paymentType = payCb.callbackQuery.data.split(':').slice(1).join(':')
  await payCb.answerCallbackQuery()

  // Шаг 3: Сумма
  await payCb.editMessageText(
    `${progressBar(3)}\n\n${filledLines({ date, operationType, paymentType })}\n\nВведите сумму:`
  )
  let amount: number | null = null
  while (!amount) {
    const amountCtx = await conversation.waitFor('message:text')
    amount = parseAmount(amountCtx.message.text.trim())
    if (!amount) await amountCtx.reply('\u{274C} Не понял сумму. Пример: 1250 или 1 250,50')
  }
  const amountStr = formatMoney(amount)

  // Шаг 4: Категория
  await ctx.reply(
    `${progressBar(4)}\n\n${filledLines({ date, operationType, paymentType, amount: amountStr })}\n\nВыберите категорию:`,
    { reply_markup: buildKb(dict.categories, 'cat', 2) }
  )
  const catCb = await conversation.waitForCallbackQuery(/^cat:/)
  const category = catCb.callbackQuery.data.split(':').slice(1).join(':')
  await catCb.answerCallbackQuery()

  // Шаг 5: Статья
  const articles = dict.articlesByCategory[category] ?? []
  if (!articles.length) {
    await catCb.editMessageText('\u{274C} Нет статей для этой категории.')
    return
  }

  await catCb.editMessageText(
    `${progressBar(5)}\n\n${filledLines({ date, operationType, paymentType, amount: amountStr, category })}\n\nВыберите статью:`,
    { reply_markup: buildKb(articles, 'art', 2) }
  )
  const artCb = await conversation.waitForCallbackQuery(/^art:/)
  const article = artCb.callbackQuery.data.split(':').slice(1).join(':')
  await artCb.answerCallbackQuery()

  // Шаг 6: Комментарий
  await artCb.editMessageText(
    `${progressBar(6)}\n\n${filledLines({ date, operationType, paymentType, amount: amountStr, category, article })}\n\nНапишите комментарий (или "-" чтобы пропустить):`
  )
  const commentCtx = await conversation.waitFor('message:text')
  const commentRaw = commentCtx.message.text.trim()
  const comment = commentRaw === '-' ? undefined : commentRaw

  // Подтверждение
  const summary = filledLines({ date, operationType, paymentType, amount: amountStr, category, article, comment })
  const confirmKb = new InlineKeyboard()
    .text('\u{2705} Сохранить', 'confirm:save')
    .text('\u{274C} Отмена', 'confirm:cancel')

  await ctx.reply(`Проверьте:\n\n${summary}`, { reply_markup: confirmKb })

  const confirmCb = await conversation.waitForCallbackQuery(/^confirm:/)
  const action = confirmCb.callbackQuery.data.split(':')[1]
  await confirmCb.answerCallbackQuery()

  if (action === 'cancel') {
    await confirmCb.editMessageText('\u{274C} Отменено.')
    return
  }

  await confirmCb.editMessageText('\u{23F3} Сохраняю...')
  const result = await conversation.external(() =>
    sheets.addEntry({ date, operationType, paymentType, amount, category, article, comment })
  )
  await confirmCb.editMessageText(`\u{2705} ${result.message}`)
}

export const registerWizard = (bot: import('grammy').Bot<BotContext>) => {
  bot.use(createConversation(addEntryConversation))
}
