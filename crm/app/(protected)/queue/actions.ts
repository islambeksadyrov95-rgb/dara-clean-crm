'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

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
  externalCallId?: string // links this disposition to the actual vpbx_calls row
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

  if (!data) {
    // Лок занят другим менеджером — дополняем сообщение именем и минутами до истечения.
    const { data: lock } = await adminSupabase
      .from('clients')
      .select('locked_by, locked_until')
      .eq('id', clientId)
      .single()

    const ownerName = lock?.locked_by ? await lockOwnerName(lock.locked_by) : null
    const minutesLeft = lock?.locked_until
      ? Math.max(0, Math.ceil((new Date(lock.locked_until).getTime() - Date.now()) / 60000))
      : null

    const who = ownerName ? `менеджером ${ownerName}` : 'другим менеджером'
    const left = minutesLeft && minutesLeft > 0 ? ` ещё ${minutesLeft} мин` : ''
    return { success: false as const, error: `Клиент занят ${who}${left}` }
  }

  return { success: true as const }
}

// Имя владельца лока по его user id (через admin auth). Для дружелюбного сообщения,
// без внутренних деталей (id/таблицы наружу не уходят).
async function lockOwnerName(userId: string): Promise<string | null> {
  try {
    const adminSupabase = createAdminClient()
    const { data, error } = await adminSupabase.auth.admin.getUserById(userId)
    if (error || !data?.user) return null
    const u = data.user
    const name = (typeof u.user_metadata?.name === 'string' && u.user_metadata.name) || u.email?.split('@')[0] || null
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : null
  } catch {
    return null
  }
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

// ─── Snooze (отложить клиента) ───
export type SnoozeUntil = '30m' | '2h' | 'tomorrow'

const ALMATY_OFFSET_MINUTES = 5 * 60 // UTC+5, без DST
const TOMORROW_HOUR_ALMATY = 9       // завтра 09:00 по Алматы

// Возвращает ISO-строку (UTC) момента, до которого клиент отложен.
function snoozeTargetUtc(until: SnoozeUntil, nowMs: number): string {
  if (until === '30m') return new Date(nowMs + 30 * 60 * 1000).toISOString()
  if (until === '2h') return new Date(nowMs + 2 * 60 * 60 * 1000).toISOString()

  // tomorrow: 09:00 следующего дня по Алматы, корректно переведённое в UTC.
  const almatyNow = new Date(nowMs + ALMATY_OFFSET_MINUTES * 60000)
  const y = almatyNow.getUTCFullYear()
  const m = almatyNow.getUTCMonth()
  const d = almatyNow.getUTCDate()
  // 09:00 Алматы завтра = (день+1) 09:00 локально-Алматы → минус смещение = UTC
  const tomorrowAlmatyMs = Date.UTC(y, m, d + 1, TOMORROW_HOUR_ALMATY, 0, 0)
  return new Date(tomorrowAlmatyMs - ALMATY_OFFSET_MINUTES * 60000).toISOString()
}

export async function snoozeClient(clientId: string, until: SnoozeUntil) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  const nextActionAt = snoozeTargetUtc(until, Date.now())
  const adminSupabase = createAdminClient()

  // Получаем текущий lock, чтобы снять его только если он наш.
  const { data: clientData } = await adminSupabase
    .from('clients')
    .select('locked_by')
    .eq('id', clientId)
    .single()

  const updateFields: Database['public']['Tables']['clients']['Update'] = {
    next_action_at: nextActionAt,
  }
  if (clientData && clientData.locked_by === user.id) {
    updateFields.locked_by = null
    updateFields.locked_until = null
  }

  const { error } = await adminSupabase
    .from('clients')
    .update(updateFields)
    .eq('id', clientId)

  if (error) return { success: false as const, error: 'Не удалось отложить клиента' }

  return { success: true as const, nextActionAt }
}

export async function recordDisposition(input: DispositionInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  const { clientId, status, subStatus, reason, nextCallDate, nextCallTime, notes, externalCallId } = input
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
      external_call_id: externalCallId || null,
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

  const { error: clientUpdateError } = await adminSupabase
    .from('clients')
    .update(updateFields)
    .eq('id', clientId)

  // Не валим диспозицию (call_log уже записан), но не глотаем ошибку молча —
  // иначе клиент мог остаться заблокированным/без ответственного без следа в логах.
  if (clientUpdateError) {
    console.error('[recordDisposition] client update failed:', clientUpdateError.message)
  }

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

// next_action_at / sticky_note отсутствуют во view client_segments — дозапрашиваем
// их напрямую из clients по списку id (явные колонки, без select('*')).
export type ClientActionMeta = {
  id: string
  next_action_at: string | null
  sticky_note: string | null
}

export async function getClientsActionMeta(clientIds: readonly string[]): Promise<ClientActionMeta[]> {
  if (clientIds.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id, next_action_at, sticky_note')
    .in('id', clientIds as string[])

  if (error) {
    console.error('[queue] getClientsActionMeta failed:', error.message)
    return []
  }
  return data ?? []
}

// Путь файла записи из сохранённого значения (старый публичный URL или просто имя файла).
function recordingPath(stored: string): string {
  const marker = '/call-recordings/'
  const idx = stored.indexOf(marker)
  return idx >= 0 ? stored.slice(idx + marker.length) : stored
}

export async function getClientCallHistory(clientId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('call_logs')
    .select('id, status, sub_status, reason, notes, created_at, audio_url, call_score, transcript, summary')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!data) return []

  // Корзина call-recordings приватная — отдаём временную подписанную ссылку (1 час),
  // а не постоянную публичную. Работает и для старых записей (путь извлекается из URL).
  const admin = createAdminClient()
  return Promise.all(
    data.map(async (row) => {
      if (!row.audio_url) return row
      const { data: signed } = await admin.storage
        .from('call-recordings')
        .createSignedUrl(recordingPath(row.audio_url), 3600)
      return { ...row, audio_url: signed?.signedUrl ?? null }
    })
  )
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

// Подстатус для WhatsApp-отправок без звонка. Такие call_logs пишутся при отправке
// WhatsApp из панели (status reached/not_reached, sub_status sent_whatsapp) и НЕ
// являются звонком — исключаются из счётчика «Звонки», считаются отдельно.
const WHATSAPP_SUB_STATUS = 'sent_whatsapp'

export async function getDayStats() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { calls: 0, reached: 0, orders: 0, revenue: 0, whatsapp: 0, planRevenuePerDay: 85000, planOrdersPerDay: 5, dayTargetCalls: 40 }

  const todayUtc = almatyTodayUtc()

  const [callsRes, reachedRes, ordersRes, whatsappRes] = await Promise.all([
    // «Звонки» — все диспозиции, КРОМЕ WhatsApp-отправок без звонка.
    // sub_status у обычных звонков NULL, поэтому фильтр пропускает NULL и любой
    // sub_status, не равный sent_whatsapp (простой neq отбросил бы NULL-строки).
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .or(`sub_status.is.null,sub_status.neq.${WHATSAPP_SUB_STATUS}`)
      .gte('created_at', todayUtc),
    // «Дозвонился» — status reached, тоже без WhatsApp-отправок.
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .eq('status', 'reached')
      .or(`sub_status.is.null,sub_status.neq.${WHATSAPP_SUB_STATUS}`)
      .gte('created_at', todayUtc),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .gte('created_at', todayUtc),
    // Отдельный счётчик WhatsApp-отправок.
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .eq('sub_status', WHATSAPP_SUB_STATUS)
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
      const dryClean = Number(dbPlan.dry_clean_target) || 0
      const blankets = Number(dbPlan.blankets_target) || 0
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
    whatsapp: whatsappRes.count ?? 0,
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
  audioUrl?: string | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false as const, error: 'Не авторизован' }

  // Обновляем последний call_log для этого клиента от этого менеджера
  const { data: lastLog } = await supabase
    .from('call_logs')
    .select('id')
    .eq('client_id', clientId)
    .eq('manager_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!lastLog) return { success: false as const, error: 'Нет записи звонка' }

  const { error } = await supabase
    .from('call_logs')
    .update({ 
      transcript, 
      summary, 
      call_score: callScore, 
      call_duration: callDuration,
      audio_url: audioUrl || null
    })
    .eq('id', lastLog.id)

  if (error) return { success: false as const, error: error.message }
  return { success: true as const }
}

export type VpbxCallRow = {
  id: string
  vpbx_uuid: string | null
  direction: 'outbound' | 'inbound' | 'internal'
  finish_status: string | null
  duration: number
  is_recorded: boolean
  transcription_status: string
  transcript: string | null
  summary: string | null
  score: number | null
  created_at: string
}

/** Recent VPBX calls for a client (RLS limits managers to their own calls). */
export async function getClientVpbxCalls(clientId: string): Promise<VpbxCallRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('vpbx_calls')
    .select('id, vpbx_uuid, direction, finish_status, duration, is_recorded, transcription_status, transcript, summary, score, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[queue] getClientVpbxCalls failed:', error.message)
    return []
  }
  return (data ?? []) as VpbxCallRow[]
}
