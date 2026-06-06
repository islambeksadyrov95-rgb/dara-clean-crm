import { InlineKeyboard, Keyboard } from 'grammy'
import { env } from './env.js'
import type { BotContext } from './types.js'

// ── Главное меню ──

export const mainMenu = new Keyboard()
  .text('\u{1F4DD} Добавить операцию')
  .row()
  .text('\u{1F4CB} Последние')
  .text('\u{1F4CA} Статистика')
  .row()
  .text('\u{1F4B5} Баланс счетов')
  .text('\u{1F4C8} ДДС')
  .row()
  .text('\u{1F3AF} Фин. положение')
  .text('\u{1F465} Доступ')
  .row()
  .text('\u{1F504} Обновить справочники')
  .resized()
  .persistent()

// ── Утилиты ──

export const todayDdMmYyyy = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  const d = parts.find((p) => p.type === 'day')!.value
  return `${d}.${m}.${y}`
}

export const displayName = (ctx: BotContext) => {
  const f = ctx.from
  if (!f) return 'Unknown'
  return [f.first_name, f.last_name].filter(Boolean).join(' ') || f.username || String(f.id)
}

// ── UI-хелперы ──

export const deletePrev = async (ctx: BotContext) => {
  const prevId = ctx.session.lastBotMsgId
  if (prevId) {
    try { await ctx.api.deleteMessage(ctx.chat!.id, prevId) } catch { /* ignore */ }
  }
}

export const sendMainMenu = async (ctx: BotContext, text: string) => {
  await deletePrev(ctx)
  const sent = await ctx.reply(text, { reply_markup: mainMenu })
  ctx.session.lastBotMsgId = sent.message_id
}

export const sendResult = async (
  ctx: BotContext,
  text: string,
  opts?: { reply_markup?: InlineKeyboard | Keyboard }
) => {
  await deletePrev(ctx)
  const sent = await ctx.reply(text, { reply_markup: opts?.reply_markup ?? mainMenu })
  ctx.session.lastBotMsgId = sent.message_id
}

export const sendWithInline = async (ctx: BotContext, text: string, inlineKb: InlineKeyboard) => {
  await deletePrev(ctx)
  await ctx.reply(text, { reply_markup: inlineKb })
  const menuMsg = await ctx.reply('\u{2B07} Главное меню', { reply_markup: mainMenu })
  ctx.session.lastBotMsgId = menuMsg.message_id
}

export const withLoading = async (ctx: BotContext, loadingText: string, fn: () => Promise<void>) => {
  const msg = await ctx.reply(`\u{23F3} ${loadingText}`)
  try {
    await fn()
  } finally {
    try { await ctx.api.deleteMessage(msg.chat.id, msg.message_id) } catch { /* ignore */ }
  }
}
