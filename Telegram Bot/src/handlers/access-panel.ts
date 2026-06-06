import { InlineKeyboard } from 'grammy'
import type { BotContext } from '../types.js'
import * as access from '../access.js'
import { sendMainMenu, sendWithInline, deletePrev } from '../shared.js'

export const handleAccessPanel = async (ctx: BotContext) => {
  const pending = await access.getPendingRequests()
  const approved = await access.getApprovedUsers()

  const lines: string[] = ['\u{1F465} Управление доступом\n']

  if (pending.length) {
    lines.push('\u{1F514} Ожидают подтверждения:')
    for (const u of pending) {
      lines.push(`  \u{23F3} ${u.displayName} (@${u.username || '—'})`)
    }
    lines.push('')
  }

  lines.push(`\u{2705} Одобренные (${approved.length}):`)
  for (const u of approved) {
    const isSa = access.isSuperAdmin(u.username)
    lines.push(`  ${isSa ? '\u{1F451}' : '\u{1F464}'} ${u.displayName} (@${u.username || '—'})`)
  }

  const kb = new InlineKeyboard()
  if (pending.length) {
    for (const u of pending) {
      kb.text(`\u{2705} ${u.displayName}`, `access_approve:${u.chatId}`)
        .text(`\u{274C} ${u.displayName}`, `access_reject:${u.chatId}`)
        .row()
    }
  }
  kb.text('\u{2795} Добавить по username', 'access_add_user').row()
  kb.text('\u{1F517} Сгенерировать ссылку', 'access_gen_link').row()
  if (approved.length) {
    kb.text('\u{1F5D1} Удалить пользователя', 'access_remove_user').row()
  }

  await sendWithInline(ctx, lines.join('\n'), kb)
}

export const registerAccessPanel = (bot: import('grammy').Bot<BotContext>) => {
  bot.hears('\u{1F465} Доступ', async (ctx) => {
    await deletePrev(ctx)
    await handleAccessPanel(ctx)
  })

  bot.callbackQuery('access_add_user', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply('\u{270F} Введите username (например @username):')
    ctx.session.draft = { _awaitingUsername: true } as any
  })

  bot.callbackQuery('access_gen_link', async (ctx) => {
    await ctx.answerCallbackQuery()
    const username = ctx.from?.username || 'admin'
    const code = await access.generateInviteCode(username)
    const botInfo = await bot.api.getMe()
    const link = `https://t.me/${botInfo.username}?start=invite_${code}`
    await ctx.reply(`\u{1F517} Ссылка для доступа:\n\n${link}\n\nОтправьте эту ссылку новому пользователю. Она одноразовая.`)
  })

  bot.callbackQuery('access_remove_user', async (ctx) => {
    await ctx.answerCallbackQuery()
    const approved = await access.getApprovedUsers()
    const removable = approved.filter((u) => !access.isSuperAdmin(u.username))

    if (!removable.length) {
      await ctx.reply('Нет пользователей для удаления.')
      return
    }

    const kb = new InlineKeyboard()
    for (const u of removable) {
      kb.text(`\u{274C} ${u.displayName} (@${u.username || '—'})`, `access_do_remove:${u.chatId}`).row()
    }
    kb.text('\u{25C0} Назад', 'access_back')

    await sendWithInline(ctx, '\u{1F5D1} Выберите кого удалить:', kb)
  })

  bot.callbackQuery(/^access_do_remove:(.+)$/, async (ctx) => {
    const targetChatId = Number(ctx.match![1])
    await ctx.answerCallbackQuery()
    const result = await access.removeUser(targetChatId)

    if (!result.ok) {
      await ctx.editMessageText(`\u{274C} ${result.reason}`)
      return
    }

    await ctx.editMessageText('\u{2705} Пользователь удалён.')

    try {
      await bot.api.sendMessage(targetChatId, '\u{274C} Ваш доступ отозван.')
    } catch { /* ignore */ }
  })

  bot.callbackQuery('access_back', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.deleteMessage()
    await handleAccessPanel(ctx)
  })

  // Обработка текстовых сообщений (для добавления по username)
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id
    if (chatId < 0) return

    const draft = ctx.session.draft as any
    if (draft?._awaitingUsername) {
      const input = ctx.message.text.trim()
      delete draft._awaitingUsername

      if (!input.startsWith('@') && !input.match(/^[a-zA-Z0-9_]{5,}$/)) {
        await ctx.reply('\u{274C} Некорректный username. Пример: @username')
        return
      }

      const result = await access.addByUsername(input, ctx.from?.username || 'admin')
      if (!result.ok) {
        await ctx.reply(`\u{274C} ${result.reason}`)
        return
      }

      await sendMainMenu(ctx, `\u{2705} Пользователь ${input} добавлен! Он получит доступ при первом /start.`)
    }
  })
}
