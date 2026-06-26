// Чистая логика ленты уведомлений (без I/O) — переиспользуется server action'ом и UI,
// тестируется юнит-тестами (tests/notification-feed.test.ts).

export const NOTIFICATION_LIMIT = 30

export type NotificationKind = 'call_inbound' | 'callback_due'

export type NotificationItem = {
  id: string // id строки notifications, либо `callback:<clientId>` для дозревшей задачи
  kind: NotificationKind
  subtype: string | null // call_inbound: incoming|missed|answered; callback_due: callback|retry
  clientId: string | null
  clientName: string | null
  phone: string | null
  count: number
  status: 'unread' | 'read'
  at: string // ISO; время сортировки/показа
}

/** Сливает звонки и дозревшие задачи в одну ленту (новейшие сверху) + считает бейдж. */
export function mergeFeed(
  calls: NotificationItem[],
  callbacks: NotificationItem[],
): { items: NotificationItem[]; unreadCount: number } {
  const items = [...calls, ...callbacks]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, NOTIFICATION_LIMIT)
  // Бейдж: непрочитанные звонки + все дозревшие задачи (они «горят», пока не обработаны).
  const unreadCount = calls.filter((c) => c.status === 'unread').length + callbacks.length
  return { items, unreadCount }
}

const MINUTE_MS = 60_000
const HOUR_MIN = 60
const DAY_HOUR = 24

/** Человеческое относительное время: «только что / N мин / N ч / N дн назад». */
export function relativeTime(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - new Date(iso).getTime()) / MINUTE_MS)
  if (minutes < 1) return 'только что'
  if (minutes < HOUR_MIN) return `${minutes} мин назад`
  const hours = Math.floor(minutes / HOUR_MIN)
  if (hours < DAY_HOUR) return `${hours} ч назад`
  return `${Math.floor(hours / DAY_HOUR)} дн назад`
}

/** Заголовок пункта по типу/подтипу (с учётом группировки нескольких пропущенных). */
export function notificationTitle(item: NotificationItem): string {
  if (item.kind === 'callback_due') return 'Пора перезвонить'
  if (item.subtype === 'missed') {
    return item.count > 1 ? `${item.count} пропущенных` : 'Пропущенный звонок'
  }
  if (item.subtype === 'answered') return 'Входящий (принят)'
  return 'Входящий звонок'
}
