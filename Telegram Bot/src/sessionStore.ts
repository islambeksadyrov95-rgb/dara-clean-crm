import type { SessionData } from './types.js'

const sessions = new Map<number, SessionData>()

export const getSession = (chatId: number): SessionData => {
  const existing = sessions.get(chatId)
  if (existing) return existing

  const created: SessionData = { draft: {} }
  sessions.set(chatId, created)
  return created
}

export const resetSession = (chatId: number) => {
  sessions.set(chatId, { draft: {} })
}
