'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  mergeFeed,
  NOTIFICATION_LIMIT,
  type NotificationItem,
} from './notification-feed'

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type NotificationsResult =
  | { success: true; items: NotificationItem[]; unreadCount: number }
  | { success: false; error: string }

/** Лента уведомлений: входящие звонки (из БД) + дозревшие задачи «перезвонить» (derive-on-read). */
export async function getNotifications(): Promise<NotificationsResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Не авторизован' }

    const [calls, callbacks] = await Promise.all([
      fetchCallNotifications(supabase),
      fetchDueCallbacks(supabase),
    ])
    return { success: true, ...mergeFeed(calls, callbacks) }
  } catch (err) {
    console.error('[getNotifications]', err)
    return { success: false, error: 'Ошибка загрузки уведомлений' }
  }
}

/** Входящие из таблицы notifications (RLS: свои + командные; админ — все). */
async function fetchCallNotifications(supabase: ServerClient): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, subtype, client_id, phone, event_count, status, updated_at, client:clients(name)')
    .eq('type', 'call_inbound')
    .order('updated_at', { ascending: false })
    .limit(NOTIFICATION_LIMIT)
  if (error) {
    console.error('[notifications.calls]', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: 'call_inbound' as const,
    subtype: r.subtype,
    clientId: r.client_id,
    clientName: r.client?.name ?? null,
    phone: r.phone,
    count: r.event_count,
    status: r.status === 'read' ? ('read' as const) : ('unread' as const),
    at: r.updated_at,
  }))
}

/** Дозревшие задачи перезвона: clients.next_action_at <= now (RLS уже даёт «мои» клиенты). */
async function fetchDueCallbacks(supabase: ServerClient): Promise<NotificationItem[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, phone, next_action_at, next_action_type')
    .not('next_action_at', 'is', null)
    .lte('next_action_at', nowIso)
    .order('next_action_at', { ascending: false })
    .limit(NOTIFICATION_LIMIT)
  if (error) {
    console.error('[notifications.callbacks]', error.message)
    return []
  }
  return (data ?? []).flatMap((c) => {
    if (!c.next_action_at) return []
    return [{
      id: `callback:${c.id}`,
      kind: 'callback_due' as const,
      subtype: c.next_action_type,
      clientId: c.id,
      clientName: c.name,
      phone: c.phone,
      count: 1,
      status: 'unread' as const,
      at: c.next_action_at,
    }]
  })
}

const IdSchema = z.string().uuid()

/** Пометить одно уведомление прочитанным (RLS ограничивает свои/командные/админ). */
export async function markNotificationRead(id: string) {
  try {
    const parsed = IdSchema.safeParse(id)
    if (!parsed.success) return { success: false as const, error: 'Некорректный id' }
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    const { error } = await supabase
      .from('notifications')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('id', parsed.data)
    if (error) {
      console.error('[markNotificationRead]', error.message)
      return { success: false as const, error: 'Не удалось обновить уведомление' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('[markNotificationRead]', err)
    return { success: false as const, error: 'Внутренняя ошибка' }
  }
}

/** Отметить все непрочитанные прочитанными. */
export async function markAllNotificationsRead() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    const { error } = await supabase
      .from('notifications')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('status', 'unread')
    if (error) {
      console.error('[markAllNotificationsRead]', error.message)
      return { success: false as const, error: 'Не удалось обновить уведомления' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('[markAllNotificationsRead]', err)
    return { success: false as const, error: 'Внутренняя ошибка' }
  }
}
