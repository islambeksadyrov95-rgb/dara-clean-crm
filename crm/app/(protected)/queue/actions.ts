'use server'

import { createClient } from '@/lib/supabase/server'

const LOCK_DURATION_MINUTES = 10

export async function lockClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Не авторизован' }
  }

  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString()

  // Атомарный лок: обновляем только если клиент свободен или лок истёк
  const { data } = await supabase
    .from('clients')
    .update({ locked_by: user.id, locked_until: lockedUntil })
    .eq('id', clientId)
    .or(`locked_by.is.null,locked_until.lt.${new Date().toISOString()}`)
    .select('id')
    .single()

  if (!data) {
    return { success: false, error: 'Клиент уже занят другим менеджером' }
  }

  return { success: true }
}

export async function unlockClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Не авторизован' }
  }

  // Разблокировать можно только своего клиента
  const { data } = await supabase
    .from('clients')
    .update({ locked_by: null, locked_until: null })
    .eq('id', clientId)
    .eq('locked_by', user.id)
    .select('id')
    .single()

  if (!data) {
    return { success: false, error: 'Клиент не заблокирован вами' }
  }

  return { success: true }
}

export async function recordDisposition(
  clientId: string,
  status: 'reached' | 'not_reached'
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Не авторизован' }
  }

  const { error: logError } = await supabase
    .from('call_logs')
    .insert({ client_id: clientId, manager_id: user.id, status })

  if (logError) {
    return { success: false, error: `Ошибка записи: ${logError.message}` }
  }

  await supabase
    .from('clients')
    .update({ locked_by: null, locked_until: null })
    .eq('id', clientId)
    .eq('locked_by', user.id)

  return { success: true }
}

export async function getDayStats() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { calls: 0, reached: 0, orders: 0 }
  }

  // Начало сегодняшнего дня (Asia/Almaty = UTC+5)
  const now = new Date()
  const almatyOffset = 5 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + almatyOffset * 60000)
  const todayStart = new Date(
    almatyNow.getFullYear(),
    almatyNow.getMonth(),
    almatyNow.getDate()
  )
  const todayUtc = new Date(todayStart.getTime() - almatyOffset * 60000).toISOString()

  const [callsRes, reachedRes, ordersRes] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .gte('created_at', todayUtc),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .eq('status', 'reached')
      .gte('created_at', todayUtc),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .gte('created_at', todayUtc),
  ])

  return {
    calls: callsRes.count ?? 0,
    reached: reachedRes.count ?? 0,
    orders: ordersRes.count ?? 0,
  }
}
