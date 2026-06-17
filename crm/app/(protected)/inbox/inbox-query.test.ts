import { describe, it, expect, vi } from 'vitest'

// inbox-query.ts → lib/wazzup/actions.ts → lib/wazzup/keys.ts импортит 'server-only'
// (бросает под node). Глушим, как остальные тесты на wazzup/server-actions.
vi.mock('server-only', () => ({}))

import { inboxDefaultChannelId, inboxChatUrlKey } from './inbox-query'
import { WAZZUP_CHANNELS } from '@/lib/wazzup/config'

describe('inboxDefaultChannelId', () => {
  it('канал первого рендера = первая вкладка WAZZUP_CHANNELS[0]', () => {
    expect(inboxDefaultChannelId()).toBe(WAZZUP_CHANNELS[0].id)
  })
})

describe('inboxChatUrlKey', () => {
  it('строит детерминированный ключ из channelId', () => {
    const key = inboxChatUrlKey('chan-1')
    expect(key[0]).toBe('inbox-chat-url')
    expect(key[1]).toBe('chan-1')
  })
  it('одинаковый channelId → структурно равный ключ (SSR-префетч ↔ клиент)', () => {
    expect(JSON.stringify(inboxChatUrlKey('chan-1'))).toBe(JSON.stringify(inboxChatUrlKey('chan-1')))
  })
  it('ключ дефолтного канала совпадает у сервера и клиента первого рендера', () => {
    const fromServer = inboxChatUrlKey(inboxDefaultChannelId())
    const fromClient = inboxChatUrlKey(WAZZUP_CHANNELS[0].id)
    expect(JSON.stringify(fromServer)).toBe(JSON.stringify(fromClient))
  })
  it('разные каналы → разные ключи (кэш по каналу)', () => {
    expect(JSON.stringify(inboxChatUrlKey('chan-1'))).not.toBe(JSON.stringify(inboxChatUrlKey('chan-2')))
  })
})
