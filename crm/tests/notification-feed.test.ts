import { describe, it, expect } from 'vitest'
import {
  mergeFeed,
  relativeTime,
  notificationTitle,
  type NotificationItem,
} from '@/app/(protected)/notifications/notification-feed'

function call(over: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n1', kind: 'call_inbound', subtype: 'missed', clientId: 'c1',
    clientName: 'Иван', phone: '+7700', count: 1, status: 'unread',
    at: '2026-06-26T10:00:00.000Z', ...over,
  }
}

describe('mergeFeed', () => {
  it('сортирует по времени убыванию (новейшие сверху)', () => {
    const older = call({ id: 'a', at: '2026-06-26T09:00:00.000Z' })
    const newer = call({ id: 'b', at: '2026-06-26T11:00:00.000Z' })
    const { items } = mergeFeed([older, newer], [])
    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('unreadCount = непрочитанные звонки + все дозревшие задачи', () => {
    const calls = [call({ id: 'a', status: 'unread' }), call({ id: 'b', status: 'read' })]
    const callbacks = [call({ id: 'cb', kind: 'callback_due', status: 'unread' })]
    expect(mergeFeed(calls, callbacks).unreadCount).toBe(2) // 1 unread call + 1 callback
  })

  it('ограничивает ленту 30 пунктами', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      call({ id: `n${i}`, at: `2026-06-26T10:${String(i).padStart(2, '0')}:00.000Z` }),
    )
    expect(mergeFeed(many, []).items).toHaveLength(30)
  })
})

describe('relativeTime', () => {
  const base = new Date('2026-06-26T12:00:00.000Z').getTime()
  it('только что (<1 мин)', () => expect(relativeTime('2026-06-26T11:59:30.000Z', base)).toBe('только что'))
  it('минуты', () => expect(relativeTime('2026-06-26T11:45:00.000Z', base)).toBe('15 мин назад'))
  it('часы', () => expect(relativeTime('2026-06-26T09:00:00.000Z', base)).toBe('3 ч назад'))
  it('дни', () => expect(relativeTime('2026-06-24T12:00:00.000Z', base)).toBe('2 дн назад'))
})

describe('notificationTitle', () => {
  it('одиночный пропущенный', () => expect(notificationTitle(call({ subtype: 'missed', count: 1 }))).toBe('Пропущенный звонок'))
  it('несколько пропущенных', () => expect(notificationTitle(call({ subtype: 'missed', count: 3 }))).toBe('3 пропущенных'))
  it('задача перезвонить', () => expect(notificationTitle(call({ kind: 'callback_due' }))).toBe('Пора перезвонить'))
})
