'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const LOCK_DURATION_MINUTES = 10
const MAX_ATTEMPTS = 3
const ATTEMPT_WINDOW_DAYS = 30

// Верхний уровень
export type CallStatus = 'reached' | 'not_reached' | 'callback' | 'declined' | 'not_relevant'

// Подстатус для детализации
export type CallSubStatus =
  | 'ordered'           // Дозвонился → оформил заказ
  | 'callback_later'    // Дозвонился → перезвонить позже
  | 'decline_expensive' // Отказ → дорого
  | 'decline_competitor'// Отказ → другая компания
  | 'decline_not_needed'// Отказ → не нужно
  | 'decline_quality'   // Отказ → недоволен качеством
  | 'decline_season'    // Отказ → не сезон
  | 'decline_other'     // Отказ → другое
  | 'wrong_number'      // Неверный номер
  | 'sent_whatsapp'     // Отправил WhatsApp
  | 'unavailable'       // Не дозвонился → недоступен
  | 'blocked'           // Не дозвонился → заблокировал

export type DispositionInput = {
  clientId: string
  status: CallStatus
  subStatus?: CallSubStatus
  reason?: string
  nextCallDate?: string   // YYYY-MM-DD
  nextCallTime?: string   // HH:MM
  notes?: string
}

export async function lockClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
  const adminSupabase = createAdminClient()

  const { data } = await adminSupabase
    .from('clients')
    .update({ locked_by: user.id, locked_until: lockedUntil })
    .eq('id', clientId)
    .or(`locked_by.is.null,locked_until.lt.${new Date().toISOString()}`)
    .select('id')
    .single()

  if (!data) return { success: false as const, error: 'Клиент уже занят другим менеджером' }

  return { success: true as const }
}

export async function unlockClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  const adminSupabase = createAdminClient()
  const { data } = await adminSupabase
    .from('clients')
    .update({ locked_by: null, locked_until: null })
    .eq('id', clientId)
    .eq('locked_by', user.id)
    .select('id')
    .single()

  if (!data) return { success: false as const, error: 'Клиент не заблокирован вами' }

  return { success: true as const }
}

export async function recordDisposition(input: DispositionInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  const { clientId, status, subStatus, reason, nextCallDate, nextCallTime, notes } = input
  const adminSupabase = createAdminClient()

  const { error: logError } = await adminSupabase
    .from('call_logs')
    .insert({
      client_id: clientId,
      manager_id: user.id,
      status,
      sub_status: subStatus || null,
      reason: reason || null,
      notes: notes || null,
      next_call_date: nextCallDate || null,
      next_call_time: nextCallTime || null,
    })

  if (logError) return { success: false as const, error: `Ошибка записи: ${logError.message}` }

  // Получаем текущие данные клиента (заблокирован ли он и есть ли ответственный)
  const { data: clientData } = await adminSupabase
    .from('clients')
    .select('assigned_manager_id, locked_by')
    .eq('id', clientId)
    .single()

  const updateFields: any = {
    last_called_at: new Date().toISOString(),
  }

  // Если клиент заблокирован текущим менеджером, снимаем блокировку
  if (clientData && clientData.locked_by === user.id) {
    updateFields.locked_by = null
    updateFields.locked_until = null
  }

  // Если у клиента нет ответственного менеджера, закрепляем его за совершившим звонок
  if (clientData && !clientData.assigned_manager_id) {
    updateFields.assigned_manager_id = user.id
  }

  await adminSupabase
    .from('clients')
    .update(updateFields)
    .eq('id', clientId)

  // 3-strike rule: проверяем количество неудачных попыток за 30 дней
  if (status === 'not_reached') {
    const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { count } = await adminSupabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'not_reached')
      .gte('created_at', windowStart)

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      // Автоматически помечаем как not_relevant
      await adminSupabase.from('call_logs').insert({
        client_id: clientId,
        manager_id: user.id,
        status: 'not_relevant',
        sub_status: 'auto_3_strikes',
        notes: `Автоматически: ${count} неудачных попыток за ${ATTEMPT_WINDOW_DAYS} дней`,
      })
    }
  }

  return { success: true as const }
}

export async function getClientCallHistory(clientId: string) {
  const adminSupabase = createAdminClient()

  const { data } = await adminSupabase
    .from('call_logs')
    .select('id, status, sub_status, reason, notes, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(5)

  return data ?? []
}

// Количество неудачных попыток за 30 дней (для отображения "Попытка X из 3")
export async function getAttemptCount(clientId: string): Promise<number> {
  const adminSupabase = createAdminClient()
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { count } = await adminSupabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'not_reached')
    .gte('created_at', windowStart)

  return count ?? 0
}

// Запланированные перезвоны на сегодня
export async function getScheduledCallbacks() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return []

  // Сегодня в Almaty
  const now = new Date()
  const almatyOffset = 5 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + almatyOffset * 60000)
  const today = `${almatyNow.getFullYear()}-${String(almatyNow.getMonth() + 1).padStart(2, '0')}-${String(almatyNow.getDate()).padStart(2, '0')}`

  const { data } = await supabase
    .from('call_logs')
    .select(`
      id,
      client_id,
      next_call_time,
      notes,
      reason,
      clients!inner (id, name, phone)
    `)
    .eq('status', 'callback')
    .eq('next_call_date', today)
    .eq('manager_id', user.id)
    .order('next_call_time', { ascending: true, nullsFirst: false })

  return (data ?? []).map((row: Record<string, unknown>) => {
    const client = row.clients as Record<string, unknown> | null
    return {
      id: row.id as string,
      clientId: row.client_id as string,
      clientName: (client?.name as string) ?? 'Без имени',
      clientPhone: (client?.phone as string) ?? '',
      time: row.next_call_time as string | null,
      notes: row.notes as string | null,
    }
  })
}

function almatyTodayUtc() {
  const now = new Date()
  const almatyOffset = 5 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + almatyOffset * 60000)
  const todayStart = new Date(almatyNow.getFullYear(), almatyNow.getMonth(), almatyNow.getDate())
  return new Date(todayStart.getTime() - almatyOffset * 60000).toISOString()
}

export async function getDayStats() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { calls: 0, reached: 0, orders: 0, revenue: 0, planRevenuePerDay: 85000, planOrdersPerDay: 5, dayTargetCalls: 40 }

  const todayUtc = almatyTodayUtc()

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

  // Выручка за сегодня
  const { data: ordersData } = await supabase
    .from('orders')
    .select('amount')
    .eq('manager_id', user.id)
    .gte('created_at', todayUtc)

  const revenue = (ordersData ?? []).reduce((s, o) => s + (Number(o.amount) || 0), 0)

  // Получаем динамические личные планы продаж текущего менеджера на этот месяц
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  let planRevenuePerDay = 85000
  let planOrdersPerDay = 5
  let dayTargetCalls = 40

  try {
    const { data: dbPlan } = await supabase
      .from('sales_plans')
      .select('carpets_target, furniture_target, curtains_target, repeat_target, dry_clean_target, blankets_target')
      .eq('manager_id', user.id)
      .eq('month', currentMonth)
      .eq('year', currentYear)
      .maybeSingle()

    if (dbPlan) {
      const carpets = Number(dbPlan.carpets_target) || 0
      const furniture = Number(dbPlan.furniture_target) || 0
      const curtains = Number(dbPlan.curtains_target) || 0
      const repeat = Number(dbPlan.repeat_target) || 0
      const dryClean = Number((dbPlan as any).dry_clean_target) || 0
      const blankets = Number((dbPlan as any).blankets_target) || 0
      const totalMonthTarget = carpets + furniture + curtains + repeat + dryClean + blankets

      if (totalMonthTarget > 0) {
        planRevenuePerDay = Math.round(totalMonthTarget / 22) // 22 рабочих дня в месяце по умолчанию
        planOrdersPerDay = Math.max(1, Math.round(planRevenuePerDay / 17000)) // средний чек 17000 ₸
      }
    }
  } catch (err) {
    console.warn('Ошибка при получении личного плана продаж для дневных лимитов:', err)
  }

  // Также пробуем получить дневной план звонков из crm_settings
  try {
    const { data: settingsData } = await supabase
      .from('crm_settings')
      .select('value')
      .eq('key', 'day_target')
      .maybeSingle()
    if (settingsData && settingsData.value) {
      dayTargetCalls = Number(settingsData.value) || 40
    }
  } catch {
    // оставляем дефолтные 40
  }

  return {
    calls: callsRes.count ?? 0,
    reached: reachedRes.count ?? 0,
    orders: ordersRes.count ?? 0,
    revenue,
    planRevenuePerDay,
    planOrdersPerDay,
    dayTargetCalls,
  }
}

// Сохранение транскрипта и оценки в последний call_log клиента
export async function saveCallTranscript(
  clientId: string,
  transcript: string,
  summary: string,
  callScore: number,
  callDuration: number,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  const adminSupabase = createAdminClient()

  // Обновляем последний call_log для этого клиента от этого менеджера
  const { data: lastLog } = await adminSupabase
    .from('call_logs')
    .select('id')
    .eq('client_id', clientId)
    .eq('manager_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!lastLog) return { success: false as const, error: 'Нет записи звонка' }

  const { error } = await adminSupabase
    .from('call_logs')
    .update({ transcript, summary, call_score: callScore, call_duration: callDuration })
    .eq('id', lastLog.id)

  if (error) return { success: false as const, error: error.message }
  return { success: true as const }
}
