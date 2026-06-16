'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import { sanitizeSearchTerm } from '@/lib/search'
import { computeSegment, parseSegmentConfig, type SegmentConfig } from '@/lib/segments'
import {
  validateConditions, applyClientConditions, needsSegmentsView,
  requiredEmbeds, broadcastNoOrderDays,
} from '@/lib/filters/apply'
import type { FilterCondition } from '@/lib/filters/types'
import { revalidatePath } from 'next/cache'
import { getUserRole } from '@/lib/auth/get-user-role'

// Загружает настроенные правила сегментации из crm_settings (через admin-клиент).
async function loadSegmentConfig(
  admin: ReturnType<typeof createAdminClient>,
): Promise<SegmentConfig> {
  const { data } = await admin
    .from('crm_settings')
    .select('value')
    .eq('key', 'segment_rules')
    .maybeSingle()
  return parseSegmentConfig(data?.value)
}

// Строка списка клиентов: общие поля clients + (для view) готовые rfm_segment/days.
interface ClientListRow {
  id: string
  name: string
  phone: string
  address: string | null
  total_orders: number
  total_spent: number | string
  last_order_date: string | null
  assigned_manager_id: string | null
  segment_override?: string | null
  rfm_segment?: string
  days_since_last_order?: number | null
}

// Создание нового клиента менеджером/админом
export async function createClient(name: string, phone: string, address?: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone || normalizedPhone.length < 10) {
      return { success: false as const, error: 'Некорректный номер телефона' }
    }

    if (!name.trim()) {
      return { success: false as const, error: 'Имя клиента не может быть пустым' }
    }

    // Проверяем дубликат телефона
    const { data: duplicate } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle()

    if (duplicate) {
      return { success: false as const, error: 'Клиент с таким номером телефона уже существует' }
    }

    // Менеджер привязывает к себе, админ тоже к себе (или может перепривязать позже)
    const assignedManagerId = user.id // автопривязка к создателю

    const { data, error } = await supabase
      .from('clients')
      .insert({
        name: name.trim(),
        phone: normalizedPhone,
        address: address?.trim() || null,
        assigned_manager_id: assignedManagerId,
      })
      .select('id')
      .single()

    if (error) {
      return { success: false as const, error: `Ошибка базы данных: ${error.message}` }
    }

    revalidatePath('/clients')
    revalidatePath('/queue')
    return { success: true as const, clientId: data.id }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Назначение менеджера клиенту (доступно только админу)
export async function assignManager(clientId: string, managerId: string | null) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (getUserRole(user) !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    const adminSupabase = createAdminClient()
    const { error } = await adminSupabase
      .from('clients')
      .update({ assigned_manager_id: managerId || null })
      .eq('id', clientId)

    if (error) {
      return { success: false as const, error: `Ошибка при назначении менеджера: ${error.message}` }
    }

    revalidatePath('/clients')
    revalidatePath(`/clients/${clientId}`)
    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Получение списка менеджеров (для админ-панели выбора)
type UserEntry = { id: string; name: string }
export type UsersDirectory = { managers: UserEntry[]; allUsers: UserEntry[] }

const EMPTY_DIRECTORY: UsersDirectory = { managers: [], allUsers: [] }

function toUserEntry(u: { id: string; email?: string; user_metadata?: { name?: string } }): UserEntry {
  const name = u.user_metadata?.name || u.email?.split('@')[0] || 'Без имени'
  return { id: u.id, name: name.charAt(0).toUpperCase() + name.slice(1) }
}

// Один вызов auth.admin.listUsers() вместо двух (getManagers + getUserNames делали по своему).
// managers — без админов (дропдаун назначения); allUsers — все (колонка «Ответственный»,
// ответственным может быть и админ: createClient привязывает клиента к создателю).
async function listUsersDirectory(): Promise<UsersDirectory> {
  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return EMPTY_DIRECTORY

  const adminSupabase = createAdminClient()
  const { data: usersData, error } = await adminSupabase.auth.admin.listUsers()
  if (error || !usersData?.users) {
    console.error('listUsersDirectory error:', error?.message)
    return EMPTY_DIRECTORY
  }

  return {
    managers: usersData.users.filter((u) => getUserRole(u) !== 'admin').map(toUserEntry),
    allUsers: usersData.users.map(toUserEntry),
  }
}

/** Менеджеры + имена всех пользователей одним запросом — для страниц со списками клиентов. */
export async function getUsersDirectory(): Promise<UsersDirectory> {
  try {
    return await listUsersDirectory()
  } catch (err) {
    console.error('getUsersDirectory error:', err)
    return EMPTY_DIRECTORY
  }
}

export async function getManagers(): Promise<UserEntry[]> {
  try {
    return (await listUsersDirectory()).managers
  } catch (err) {
    console.error('getManagers error:', err)
    return []
  }
}

export async function getUserNames(): Promise<UserEntry[]> {
  try {
    return (await listUsersDirectory()).allUsers
  } catch (err) {
    console.error('getUserNames error:', err)
    return []
  }
}

// Получение истории звонков с именами менеджеров
export async function getClientCallHistoryWithNames(clientId: string) {
  try {
    const supabase = await createSupabaseClient()
    
    // Получаем звонки
    const { data: callLogs, error } = await supabase
      .from('call_logs')
      .select('id, status, sub_status, reason, notes, created_at, manager_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (error || !callLogs) {
      return []
    }

    // Получаем уникальные ID менеджеров
    const managerIds = Array.from(new Set(callLogs.map((log) => log.manager_id).filter(Boolean)))

    if (managerIds.length === 0) {
      return callLogs.map((log) => ({
        ...log,
        manager_name: 'Система',
      }))
    }

    // Получаем имена менеджеров через Admin API
    const adminSupabase = createAdminClient()
    const { data: usersData } = await adminSupabase.auth.admin.listUsers()
    const users = usersData?.users || []

    const managerNamesMap = new Map<string, string>()
    users.forEach((u) => {
      const name = u.user_metadata?.name || u.email?.split('@')[0] || 'Без имени'
      managerNamesMap.set(u.id, name.charAt(0).toUpperCase() + name.slice(1))
    })

    return callLogs.map((log) => ({
      id: log.id,
      status: log.status,
      sub_status: log.sub_status || null,
      reason: log.reason || null,
      notes: log.notes || null,
      created_at: log.created_at,
      manager_name: managerNamesMap.get(log.manager_id) || 'Неизвестный менеджер',
    }))
  } catch (err) {
    console.error('getClientCallHistoryWithNames error:', err)
    return []
  }
}

// Массовое назначение менеджера
export async function bulkAssignManager(clientIds: string[], managerId: string | null) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (getUserRole(user) !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    if (clientIds.length === 0) {
      return { success: true as const }
    }

    const adminSupabase = createAdminClient()
    const chunkError = await updateClientsChunked(adminSupabase, clientIds, { assigned_manager_id: managerId || null })
    if (chunkError) {
      console.error('[bulkAssignManager]', chunkError)
      return { success: false as const, error: 'Ошибка при массовом назначении менеджера' }
    }

    revalidatePath('/clients')
    revalidatePath('/queue')
    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Массовое назначение сегмента вручную. segment === null → сброс на авто-расчёт.
// Иначе segment должен быть одним из настроенных названий (пишется в clients.segment_override).
export async function bulkAssignSegment(clientIds: string[], segment: string | null) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (getUserRole(user) !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    if (clientIds.length === 0) {
      return { success: true as const }
    }

    const admin = createAdminClient()

    let override: string | null = null
    if (segment) {
      const config = await loadSegmentConfig(admin)
      if (!config.segments.some((s) => s.name === segment)) {
        return { success: false as const, error: 'Неизвестный сегмент' }
      }
      override = segment
    }

    const chunkError = await updateClientsChunked(admin, clientIds, { segment_override: override })
    if (chunkError) {
      console.error('[bulkAssignSegment]', chunkError)
      return { success: false as const, error: 'Ошибка при массовом назначении сегмента' }
    }

    revalidatePath('/clients')
    revalidatePath('/queue')
    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Дни с последнего заказа + сегмент (override имеет приоритет над авто-расчётом по правилам).
function calculateRfmAndDays(
  totalOrders: number,
  lastOrderDateStr: string | null,
  override: string | null,
  config: SegmentConfig,
) {
  let daysSinceLastOrder: number | null = null

  if (lastOrderDateStr) {
    const lastOrderDate = new Date(lastOrderDateStr)
    const today = new Date()
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const orderDate = new Date(lastOrderDate.getFullYear(), lastOrderDate.getMonth(), lastOrderDate.getDate())
    daysSinceLastOrder = Math.floor((todayDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))
  }

  const rfmSegment = override ?? computeSegment(totalOrders, daysSinceLastOrder, config)
  return { rfmSegment, daysSinceLastOrder }
}

// Обновление клейкой заметки о клиенте (менеджер может, RLS ограничивает по assigned_manager_id).
export async function updateClientStickyNote(clientId: string, note: string | null) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    // .select('id') — детект 0 строк: RLS молча отбрасывает update чужого клиента,
    // без этого менеджер увидел бы ложное «Сохранено».
    const { data: updated, error } = await supabase
      .from('clients')
      .update({ sticky_note: note ?? null })
      .eq('id', clientId)
      .select('id')

    if (error) {
      return { success: false as const, error: 'Ошибка при сохранении заметки' }
    }
    if (!updated || updated.length === 0) {
      return { success: false as const, error: 'Нет прав: заметку можно менять только своим клиентам' }
    }

    revalidatePath(`/clients/${clientId}`)
    return { success: true as const }
  } catch {
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

// Обновление следующего шага (дата + заметка). at === null → очистить поле.
export async function updateClientNextAction(
  clientId: string,
  at: string | null,
  note: string | null,
) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    // .select('id') — детект 0 строк (RLS чужого клиента), см. updateClientStickyNote.
    const { data: updated, error } = await supabase
      .from('clients')
      .update({ next_action_at: at ?? null, next_action_note: note ?? null })
      .eq('id', clientId)
      .select('id')

    if (error) {
      return { success: false as const, error: 'Ошибка при сохранении следующего шага' }
    }
    if (!updated || updated.length === 0) {
      return { success: false as const, error: 'Нет прав: следующий шаг можно менять только своим клиентам' }
    }

    revalidatePath(`/clients/${clientId}`)
    return { success: true as const }
  } catch {
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

// Правка контактов клиента (имя/телефон/адрес) прямо из карточки.
// RLS ограничивает строку по assigned_manager_id (как updateClientStickyNote); телефон
// нормализуется и проверяется на уникальность БД (23505 → дружелюбная ошибка).
export async function updateClientContact(
  clientId: string,
  patch: { name: string; phone: string; address: string | null },
) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    const name = patch.name.trim()
    if (!name) return { success: false as const, error: 'Имя клиента не может быть пустым' }
    const phone = normalizePhone(patch.phone)
    if (!phone || phone.length < 10) return { success: false as const, error: 'Некорректный номер телефона' }
    const address = patch.address?.trim() || null

    // .select('id') — детект 0 строк (RLS чужого клиента), см. updateClientStickyNote.
    const { data: updated, error } = await supabase
      .from('clients')
      .update({ name, phone, address })
      .eq('id', clientId)
      .select('id')

    if (error) {
      if (error.code === '23505') return { success: false as const, error: 'Этот номер уже есть у другого клиента' }
      console.error('[updateClientContact]', error)
      return { success: false as const, error: 'Ошибка при сохранении контактов' }
    }
    if (!updated || updated.length === 0) {
      return { success: false as const, error: 'Нет прав: контакты можно менять только своим клиентам' }
    }

    revalidatePath(`/clients/${clientId}`)
    revalidatePath('/clients')
    return { success: true as const, name, phone, address }
  } catch {
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

// Получение полной информации для карточки клиента (в обход RLS)
export async function getClientCardData(clientId: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const adminSupabase = createAdminClient()

    const [clientRes, ordersRes, orderHistoryRes, callLogs] = await Promise.all([
      adminSupabase
        .from('clients')
        .select('id, name, phone, address, total_orders, total_spent, avg_order_value, last_order_date, assigned_manager_id, segment_override, next_action_at, next_action_note, sticky_note')
        .eq('id', clientId)
        .single(),
      adminSupabase
        .from('orders')
        .select('id, services, amount, discount_percent, discount_amount, comment, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      adminSupabase
        .from('order_history')
        .select('id, order_date, amount, service, address, source')
        .eq('client_id', clientId)
        .order('order_date', { ascending: false }),
      getClientCallHistoryWithNames(clientId)
    ])

    if (clientRes.error || !clientRes.data) {
      return { success: false as const, error: 'Клиент не найден в базе' }
    }

    const rawClient = clientRes.data
    const segmentConfig = await loadSegmentConfig(adminSupabase)
    const { rfmSegment, daysSinceLastOrder } = calculateRfmAndDays(
      rawClient.total_orders,
      rawClient.last_order_date,
      rawClient.segment_override ?? null,
      segmentConfig
    )

    const client = {
      id: rawClient.id,
      name: rawClient.name,
      phone: rawClient.phone,
      address: rawClient.address || null,
      total_orders: rawClient.total_orders,
      total_spent: Number(rawClient.total_spent) || 0,
      avg_order_value: Number(rawClient.avg_order_value) || 0,
      last_order_date: rawClient.last_order_date,
      assigned_manager_id: rawClient.assigned_manager_id,
      rfm_segment: rfmSegment,
      days_since_last_order: daysSinceLastOrder,
      next_action_at: rawClient.next_action_at ?? null,
      next_action_note: rawClient.next_action_note ?? null,
      sticky_note: rawClient.sticky_note ?? null,
    }

    return {
      success: true as const,
      client,
      orders: ordersRes.data || [],
      orderHistory: orderHistoryRes.data || [],
      callLogs
    }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// ─── Хелперы фильтрованных запросов (общие для списка и массовых действий) ───

const BULK_CHUNK = 200

// Чанками: .in() с тысячами uuid не влезает в URL PostgREST.
async function updateClientsChunked(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
  payload: { assigned_manager_id?: string | null; segment_override?: string | null },
): Promise<string | null> {
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const { error } = await admin.from('clients').update(payload).in('id', ids.slice(i, i + BULK_CHUNK))
    if (error) return error.message
  }
  return null
}

/** Добавляет embed-строки кросс-сущностных условий к списку колонок select. */
function withEmbeds(columns: string, conditions: FilterCondition[]): string {
  const embeds = requiredEmbeds(conditions)
  return embeds.length > 0 ? `${columns}, ${embeds.join(', ')}` : columns
}

/**
 * «Рассылка без заказа»: ids через RPC до основного запроса.
 * null — условие не задано; [] — совпадений нет (caller возвращает пустой список).
 */
async function resolveBroadcastNoOrder(
  admin: ReturnType<typeof createAdminClient>,
  conditions: FilterCondition[],
): Promise<string[] | null> {
  const days = broadcastNoOrderDays(conditions)
  if (!days) return null
  const { data, error } = await admin.rpc('broadcast_no_order_ids', { p_days: days })
  if (error) {
    console.error('[filters] broadcast_no_order_ids:', error.message)
    throw new Error('Ошибка фильтра «Рассылка без заказа»')
  }
  // cap 1000: больше не влезает в URL PostgREST; для SMB-базы достаточно
  return (data ?? []).map((r) => r.client_id).slice(0, 1000)
}

// Сырой ряд clients/client_segments при динамическом select (embeds → .returns<>).
type ClientListSourceRow = {
  id: string | null
  name: string | null
  phone: string | null
  address: string | null
  total_orders: number | null
  total_spent: number | null
  last_order_date: string | null
  assigned_manager_id: string | null
  segment_override: string | null
  rfm_segment?: string | null
  days_since_last_order?: number | null
}

// Получение списка клиентов (в обход RLS для поиска по всей базе)
export async function getClientsList(filters: {
  search?: string
  segment?: string
  page: number
  pageSize: number
  conditions?: unknown
}) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const adminSupabase = createAdminClient()

    // Условия FilterBar: валидация на границе (Zod + whitelist полей).
    const conditions = validateConditions(filters.conditions ?? [])

    // «Рассылка без заказа» — асинхронное условие (RPC). Пустой список ids = пустой результат.
    const broadcastIds = await resolveBroadcastNoOrder(adminSupabase, conditions)
    if (broadcastIds && broadcastIds.length === 0) {
      return { success: true as const, clients: [], total: 0 }
    }

    // Если сегмент конкретный (чип или условие FilterBar) — читаем из client_segments
    // (активные клиенты, rfm считается в SQL). Иначе из clients, чтобы не потерять отказников.
    const useSegmentsView =
      (filters.segment && filters.segment !== 'Все') || needsSegmentsView(conditions)

    // Колонки, общие для таблицы clients и view client_segments.
    const LIST_COLUMNS =
      'id, name, phone, address, total_orders, total_spent, last_order_date, assigned_manager_id, segment_override'
    const SEGMENT_COLUMNS = `${LIST_COLUMNS}, rfm_segment, days_since_last_order`

    const sanitizedSearch = sanitizeSearchTerm(filters.search ?? '')
    const searchTerm = sanitizedSearch ? `%${sanitizedSearch}%` : null
    const rangeFrom = filters.page * filters.pageSize
    const rangeTo = (filters.page + 1) * filters.pageSize - 1

    // .from() с union-аргументом не сходится по overload'ам supabase-js —
    // строим каждую ветку отдельным literal-вызовом.
    // ВНИМАНИЕ: логика веток зеркалится в getClientIdsByFilter — менять синхронно.
    const buildQuery = () => {
      if (useSegmentsView) {
        let q = adminSupabase
          .from('client_segments')
          .select(withEmbeds(SEGMENT_COLUMNS, conditions), { count: 'exact' })
        if (searchTerm) q = q.or(`name.ilike.${searchTerm},phone.ilike.${searchTerm}`)
        // Чип сегмента: eq только когда он реально выбран — ветка view может быть
        // активна и из-за условия rfm_segment в FilterBar (без чипа).
        if (filters.segment && filters.segment !== 'Все') q = q.eq('rfm_segment', filters.segment)
        if (broadcastIds) q = q.in('id', broadcastIds)
        applyClientConditions(q, conditions)
        return q
          .order('last_order_date', { ascending: true, nullsFirst: true })
          .range(rangeFrom, rangeTo)
          .returns<ClientListSourceRow[]>()
      }
      let q = adminSupabase
        .from('clients')
        .select(withEmbeds(LIST_COLUMNS, conditions), { count: 'exact' })
      if (searchTerm) q = q.or(`name.ilike.${searchTerm},phone.ilike.${searchTerm}`)
      if (broadcastIds) q = q.in('id', broadcastIds)
      applyClientConditions(q, conditions)
      return q
        .order('last_order_date', { ascending: true, nullsFirst: true })
        .range(rangeFrom, rangeTo)
        .returns<ClientListSourceRow[]>()
    }

    // Для ветки "Все" сегмент считаем на сервере (view с rfm_segment там не используется).
    // Конфиг независим от основного запроса — грузим параллельно, не последовательно.
    const [{ data, count, error }, segmentConfig] = await Promise.all([
      buildQuery(),
      useSegmentsView ? Promise.resolve(null) : loadSegmentConfig(adminSupabase),
    ])

    if (error || !data) {
      return { success: false as const, error: error?.message || 'Ошибка загрузки' }
    }

    // Ряды clients и client_segments различаются формой (view имеет nullable-поля
    // и готовый rfm_segment). Приводим оба к единому ClientListRow.
    const rows: ClientListRow[] = data.map((row) => ({
      id: row.id ?? '',
      name: row.name ?? '',
      phone: row.phone ?? '',
      address: row.address ?? null,
      total_orders: row.total_orders ?? 0,
      total_spent: row.total_spent ?? 0,
      last_order_date: row.last_order_date ?? null,
      assigned_manager_id: row.assigned_manager_id ?? null,
      segment_override: row.segment_override ?? null,
      rfm_segment: 'rfm_segment' in row ? row.rfm_segment ?? undefined : undefined,
      days_since_last_order:
        'days_since_last_order' in row ? row.days_since_last_order ?? null : null,
    }))

    const clients = rows.map((row) => {
      let rfmSegment = row.rfm_segment ?? 'Новый'
      let daysSinceLastOrder = row.days_since_last_order ?? null

      if (!useSegmentsView && segmentConfig) {
        const calc = calculateRfmAndDays(
          row.total_orders,
          row.last_order_date,
          row.segment_override ?? null,
          segmentConfig
        )
        rfmSegment = calc.rfmSegment
        daysSinceLastOrder = calc.daysSinceLastOrder
      }

      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        address: row.address || null,
        total_orders: row.total_orders,
        total_spent: Number(row.total_spent) || 0,
        last_order_date: row.last_order_date,
        assigned_manager_id: row.assigned_manager_id,
        rfm_segment: rfmSegment,
        days_since_last_order: daysSinceLastOrder
      }
    })

    return {
      success: true as const,
      clients,
      total: count || 0
    }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// ─── Словари для опций FilterBar (теги, источники, услуги) ───

export type FilterDictionaries = {
  tags: { id: string; name: string }[]
  sources: { id: string; name: string }[]
  services: string[]
}

const EMPTY_DICTIONARIES: FilterDictionaries = { tags: [], sources: [], services: [] }

export async function getFilterDictionaries(): Promise<FilterDictionaries> {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return EMPTY_DICTIONARIES

    const admin = createAdminClient()
    // Падение одного словаря не должно ломать остальные (R10).
    const [tagsRes, sourcesRes, servicesRes] = await Promise.allSettled([
      admin.from('tags').select('id, name').order('name'),
      admin.from('acquisition_sources').select('id, name').eq('is_active', true).order('name'),
      admin.rpc('distinct_order_services'),
    ])

    return {
      tags: tagsRes.status === 'fulfilled' ? (tagsRes.value.data ?? []) : [],
      sources: sourcesRes.status === 'fulfilled' ? (sourcesRes.value.data ?? []) : [],
      services:
        servicesRes.status === 'fulfilled'
          ? (servicesRes.value.data ?? []).map((r) => r.service).filter(Boolean)
          : [],
    }
  } catch (err) {
    console.error('getFilterDictionaries error:', err)
    return EMPTY_DICTIONARIES
  }
}

// ─── «Выбрать всю выборку» для массовых действий (admin) ───

const MAX_BULK_IDS = 5000

/**
 * Id всех клиентов, попадающих под текущий фильтр страницы.
 * Логика веток зеркалит getClientsList.buildQuery — менять синхронно.
 */
export async function getClientIdsByFilter(filters: {
  search?: string
  segment?: string
  conditions?: unknown
}) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }
    if (getUserRole(user) !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    const adminSupabase = createAdminClient()
    const conditions = validateConditions(filters.conditions ?? [])

    const broadcastIds = await resolveBroadcastNoOrder(adminSupabase, conditions)
    if (broadcastIds && broadcastIds.length === 0) return { success: true as const, ids: [] as string[] }

    const useSegmentsView =
      (filters.segment && filters.segment !== 'Все') || needsSegmentsView(conditions)
    const sanitizedSearch = sanitizeSearchTerm(filters.search ?? '')
    const searchTerm = sanitizedSearch ? `%${sanitizedSearch}%` : null

    const buildQuery = () => {
      if (useSegmentsView) {
        let q = adminSupabase.from('client_segments').select(withEmbeds('id', conditions))
        if (searchTerm) q = q.or(`name.ilike.${searchTerm},phone.ilike.${searchTerm}`)
        if (filters.segment && filters.segment !== 'Все') q = q.eq('rfm_segment', filters.segment)
        if (broadcastIds) q = q.in('id', broadcastIds)
        applyClientConditions(q, conditions)
        return q.limit(MAX_BULK_IDS).returns<{ id: string }[]>()
      }
      let q = adminSupabase.from('clients').select(withEmbeds('id', conditions))
      if (searchTerm) q = q.or(`name.ilike.${searchTerm},phone.ilike.${searchTerm}`)
      if (broadcastIds) q = q.in('id', broadcastIds)
      applyClientConditions(q, conditions)
      return q.limit(MAX_BULK_IDS).returns<{ id: string }[]>()
    }

    const { data, error } = await buildQuery()
    if (error) {
      console.error('getClientIdsByFilter error:', error.message)
      return { success: false as const, error: 'Ошибка выборки клиентов' }
    }
    return { success: true as const, ids: (data ?? []).map((r) => r.id) }
  } catch (err) {
    console.error('getClientIdsByFilter error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

// ─── Сохранённые фильтры (общие на команду) ───

export type SavedFilter = { id: string; name: string; conditions: FilterCondition[] }

export async function listSavedFilters(page: 'clients' | 'queue'): Promise<SavedFilter[]> {
  try {
    const supabase = await createSupabaseClient()
    const { data, error } = await supabase
      .from('saved_filters')
      .select('id, name, conditions')
      .eq('page', page)
      .order('name')
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      conditions: validateConditions(row.conditions),
    }))
  } catch (err) {
    console.error('listSavedFilters error:', err)
    return []
  }
}

export async function saveClientFilter(page: 'clients' | 'queue', name: string, conditions: unknown) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 60) {
      return { success: false as const, error: 'Название фильтра: 1–60 символов' }
    }
    const validated = validateConditions(conditions)
    if (validated.length === 0) {
      return { success: false as const, error: 'Нечего сохранять: фильтр пуст' }
    }

    const { error } = await supabase
      .from('saved_filters')
      .insert({ page, name: trimmed, conditions: validated, created_by: user.id })
    if (error) {
      if (error.code === '23505') return { success: false as const, error: 'Фильтр с таким названием уже есть' }
      console.error('saveClientFilter error:', error.message)
      return { success: false as const, error: 'Не удалось сохранить фильтр' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('saveClientFilter error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

export async function deleteSavedFilter(id: string) {
  try {
    const supabase = await createSupabaseClient()
    const { error } = await supabase.from('saved_filters').delete().eq('id', id)
    if (error) {
      console.error('deleteSavedFilter error:', error.message)
      return { success: false as const, error: 'Не удалось удалить фильтр' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('deleteSavedFilter error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

