import type { Context, SessionFlavor } from 'grammy'
import type { ConversationFlavor } from '@grammyjs/conversations'

export type DraftEntry = {
  operationType?: string
  paymentType?: string
  category?: string
  article?: string
  employee?: string
  amount?: number
  comment?: string
  dateIso?: string
}

export type SessionData = {
  draft: DraftEntry
  lastBotMsgId?: number
}

type BaseContext = Context & SessionFlavor<SessionData>
export type BotContext = ConversationFlavor<BaseContext>
