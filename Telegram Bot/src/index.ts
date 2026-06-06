import { Bot, InlineKeyboard, session } from 'grammy'
import { conversations } from '@grammyjs/conversations'

import { env } from './env.js'
import * as access from './access.js'
import { getDict, invalidateDict } from './dict.js'
import { mainMenu, displayName, sendMainMenu, deletePrev, withLoading } from './shared.js'
import type { BotContext, SessionData } from './types.js'

import { registerWizard } from './handlers/wizard.js'
import { registerOnboarding, sendOnboarding, ONBOARDING_STEPS } from './handlers/onboarding.js'
import { registerStats, handleLast, handleStats } from './handlers/stats.js'
import { registerDds } from './handlers/dds.js'
import { registerBalance } from './handlers/balance.js'
import { registerAccessPanel } from './handlers/access-panel.js'
import { scheduleReminder } from './handlers/reminder.js'

const bot = new Bot<BotContext>(env.BOT_TOKEN)

bot.use(
  session({
    initial: (): SessionData => ({ draft: {} })
  })
)

// Middleware: всегда прикрепляем ReplyKeyboard к сообщениям без reply_markup
bot.api.config.use((prev, method, payload, signal) => {
  if (method === 'sendMessage' && payload && !('reply_markup' in payload && payload.reply_markup)) {
    (payload as any).reply_markup = {
      keyboard: [
        [{ text: '\u{1F4DD} Добавить операцию' }],
        [{ text: '\u{1F4CB} Последние' }, { text: '\u{1F4CA} Статистика' }],
        [{ text: '\u{1F4B5} Баланс счетов' }, { text: '\u{1F4C8} ДДС' }],
        [{ text: '\u{1F3AF} Фин. положение' }, { text: '\u{1F465} Доступ' }],
        [{ text: '\u{1F504} Обновить справочники' }]
      ],
      resize_keyboard: true,
      is_persistent: true
    }
  }
  return prev(method, payload, signal)
})

bot.use(conversations())

// ── Регистрируем wizard (createConversation) перед обработчиками ──
registerWizard(bot)

// ── Middleware: проверка доступа ──

const requireAccess = async (ctx: BotContext, next: () => Promise<void>) => {
  const text = ctx.message?.text || ''
  if (text.startsWith('/start')) return next()

  const chatId = ctx.chat?.id ?? 0
  const username = ctx.from?.username || ''

  const approved = await access.isApproved(chatId, username)
  if (!approved) {
    if (username) {
      const byUsername = await access.isApprovedByUsername(username)
      if (byUsername) {
        await access.claimByUsername(username, chatId, displayName(ctx))
        return next()
      }
    }
    await ctx.reply('\u{1F6AB} У вас нет доступа. Нажмите /start чтобы запросить.')
    return
  }

  return next()
}

// ── /start ──

bot.command('start', async (ctx) => {
  if (ctx.chat.id < 0) {
    await ctx.reply('Напишите мне в личные сообщения.')
    return
  }

  const chatId = ctx.chat.id
  const username = ctx.from?.username || ''
  const name = displayName(ctx)

  const payload = ctx.match?.toString().trim() || ''
  if (payload.startsWith('invite_')) {
    const code = payload.replace('invite_', '')
    const ok = await access.redeemInviteCode(code, chatId, username, name)
    if (ok) {
      await sendOnboarding(ctx, 0)
      return
    }
    await ctx.reply('\u{274C} Ссылка недействительна или уже использована.')
  }

  if (access.isSuperAdmin(username)) {
    await sendMainMenu(ctx, `\u{1F44B} Привет, ${name}! Вы главный администратор.\n\nТаблица подключена \u{2705}`)
    return
  }

  const approved = await access.isApproved(chatId, username)
  if (approved) {
    await sendMainMenu(ctx, `\u{1F44B} Привет, ${name}!\n\nТаблица подключена \u{2705}`)
    return
  }

  if (username) {
    const byUsername = await access.isApprovedByUsername(username)
    if (byUsername) {
      await access.claimByUsername(username, chatId, name)
      await sendOnboarding(ctx, 0)
      return
    }
  }

  const status = await access.requestAccess(chatId, username, name)
  if (status === 'pending') {
    await ctx.reply(`\u{23F3} Запрос отправлен!\n\nОжидайте подтверждения от администратора.\nВаш username: @${username || 'не указан'}`)

    const admins = await access.getApprovedUsers()
    const notifyKb = new InlineKeyboard()
      .text('\u{2705} Одобрить', `access_approve:${chatId}`)
      .text('\u{274C} Отклонить', `access_reject:${chatId}`)

    for (const admin of admins) {
      if (admin.chatId > 0) {
        try {
          await bot.api.sendMessage(
            admin.chatId,
            `\u{1F514} Новый запрос доступа!\n\nИмя: ${name}\nUsername: @${username || '—'}\nChat ID: ${chatId}`,
            { reply_markup: notifyKb }
          )
        } catch { /* ignore */ }
      }
    }
  } else {
    await ctx.reply('\u{23F3} Ваш запрос уже на рассмотрении. Ожидайте.')
  }
})

// ── Одобрение/отклонение доступа (до middleware requireAccess) ──

bot.callbackQuery(/^access_approve:(\d+)$/, async (ctx) => {
  const targetChatId = Number(ctx.match![1])
  const ok = await access.approveUser(targetChatId)
  await ctx.answerCallbackQuery()

  if (!ok) {
    await ctx.editMessageText('\u{2753} Запрос уже обработан.')
    return
  }

  await ctx.editMessageText(`\u{2705} Доступ одобрен для chat ID ${targetChatId}.`)

  try {
    const kb = new InlineKeyboard().text(ONBOARDING_STEPS[0].btn, 'onboard_next:1')
    await bot.api.sendMessage(targetChatId, `\u{2705} Ваш доступ одобрен!\n\n${ONBOARDING_STEPS[0].text}`, { reply_markup: kb })
  } catch { /* ignore */ }
})

bot.callbackQuery(/^access_reject:(\d+)$/, async (ctx) => {
  const targetChatId = Number(ctx.match![1])
  const ok = await access.rejectUser(targetChatId)
  await ctx.answerCallbackQuery()

  if (!ok) {
    await ctx.editMessageText('\u{2753} Запрос уже обработан.')
    return
  }

  await ctx.editMessageText(`\u{274C} Запрос отклонён для chat ID ${targetChatId}.`)

  try {
    await bot.api.sendMessage(targetChatId, '\u{274C} Ваш запрос отклонён.')
  } catch { /* ignore */ }
})

// ── Middleware доступа (после /start и access callbacks) ──

bot.use(requireAccess)

// ── Команды ──

bot.command('help', async (ctx) => { await sendMainMenu(ctx, 'Выберите действие:') })

bot.command('add', async (ctx) => {
  if (ctx.chat.id < 0) return
  await ctx.conversation.enter('addEntryConversation')
})

bot.command('cancel', async (ctx) => {
  await ctx.conversation.exit('addEntryConversation')
  await sendMainMenu(ctx, '\u{274C} Отменено.')
})

bot.command('dict', async (ctx) => {
  invalidateDict()
  await getDict()
  await sendMainMenu(ctx, '\u{2705} Справочники обновлены.')
})

bot.command('last', async (ctx) => {
  if (ctx.chat.id < 0) return
  await handleLast(ctx)
})

bot.command('stats', async (ctx) => {
  if (ctx.chat.id < 0) return
  await handleStats(ctx)
})

// ── Кнопки главного меню ──

bot.hears('\u{1F4DD} Добавить операцию', async (ctx) => {
  if (ctx.chat.id < 0) return
  await deletePrev(ctx)
  await ctx.conversation.enter('addEntryConversation')
})

bot.hears('\u{1F504} Обновить справочники', async (ctx) => {
  await withLoading(ctx, 'Обновляю справочники...', async () => {
    invalidateDict()
    await getDict()
    await sendMainMenu(ctx, '\u{2705} Справочники обновлены.')
  })
})

// ── Reminder callback ──

bot.callbackQuery('reminder_add', async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.conversation.enter('addEntryConversation')
})

// ── Регистрируем остальные обработчики ──

registerOnboarding(bot)
registerStats(bot)
registerDds(bot)
registerBalance(bot)
registerAccessPanel(bot)

// ── Error handler ──

bot.catch(async (err) => {
  const message = err.error instanceof Error ? err.error.message : 'Unknown error'
  console.error('Bot error:', message)
  try {
    await err.ctx.reply(`\u{274C} Ошибка: ${message}`)
  } catch { /* ignore */ }
})

// ── Start ──

await bot.api.deleteWebhook({ drop_pending_updates: true })
bot.start({
  onStart: () => {
    console.log('Bot started successfully')
    scheduleReminder(bot)
  },
  drop_pending_updates: true
})

const shutdown = async () => {
  console.log('Shutting down...')
  await bot.stop()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
