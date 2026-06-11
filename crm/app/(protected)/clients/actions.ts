'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import { sanitizeSearchTerm } from '@/lib/search'
import { computeSegment, parseSegmentConfig, type SegmentConfig } from '@/lib/segments'
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
export async function getManagers() {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return []
    }

    const adminSupabase = createAdminClient()
    const { data: usersData, error } = await adminSupabase.auth.admin.listUsers()

    if (error || !usersData?.users) {
      console.error('Error listing users:', error?.message)
      return []
    }

    // Фильтруем пользователей с ролью manager (или у кого роль не admin)
    return usersData.users
      .filter((u) => getUserRole(u) !== 'admin')
      .map((u) => {
        const name = u.user_metadata?.name || u.email?.split('@')[0] || 'Без имени'
        return {
          id: u.id,
          name: name.charAt(0).toUpperCase() + name.slice(1),
        }
      })
  } catch (err) {
    console.error('getManagers error:', err)
    return []
  }
}

// Имена ВСЕХ пользователей (включая админов) — для отображения колонки «Ответственный».
// В отличие от getManagers (фильтрует админов для дропдауна назначения), здесь роль не важна:
// ответственным может быть и админ (createClient привязывает клиента к создателю).
export async function getUserNames(): Promise<{ id: string; name: string }[]> {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const adminSupabase = createAdminClient()
    const { data: usersData, error } = await adminSupabase.auth.admin.listUsers()
    if (error || !usersData?.users) {
      console.error('getUserNames error:', error?.message)
      return []
    }

    return usersData.users.map((u) => {
      const name = u.user_metadata?.name || u.email?.split('@')[0] || 'Без имени'
      return { id: u.id, name: name.charAt(0).toUpperCase() + name.slice(1) }
    })
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
    const { error } = await adminSupabase
      .from('clients')
      .update({ assigned_manager_id: managerId || null })
      .in('id', clientIds)

    if (error) {
      return { success: false as const, error: `Ошибка при массовом назначении менеджера: ${error.message}` }
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

    const { error } = await admin
      .from('clients')
      .update({ segment_override: override })
      .in('id', clientIds)

    if (error) {
      return { success: false as const, error: `Ошибка при массовом назначении сегмента: ${error.message}` }
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

// Получение полной информации для карточки клиента (в обход RLS)
export async function getClientCardData(clientId: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const adminSupabase = createAdminClient()

    const [clientRes, ordersRes, callLogs] = await Promise.all([
      adminSupabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single(),
      adminSupabase
        .from('orders')
        .select('id, services, amount, discount_percent, discount_amount, comment, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
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
      days_since_last_order: daysSinceLastOrder
    }

    return {
      success: true as const,
      client,
      orders: ordersRes.data || [],
      callLogs
    }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Получение списка клиентов (в обход RLS для поиска по всей базе)
export async function getClientsList(filters: {
  search?: string
  segment?: string
  page: number
  pageSize: number
}) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const adminSupabase = createAdminClient()
    
    // Если сегмент конкретный - читаем из client_segments (активные клиенты)
    // Если сегмент "Все" - читаем из clients, чтобы не потерять отказников
    const useSegmentsView = filters.segment && filters.segment !== 'Все'
    
    let query = adminSupabase
      .from(useSegmentsView ? 'client_segments' : 'clients')
      .select('*', { count: 'exact' })

    const sanitizedSearch = sanitizeSearchTerm(filters.search ?? '')
    if (sanitizedSearch) {
      const term = `%${sanitizedSearch}%`
      query = query.or(`name.ilike.${term},phone.ilike.${term}`)
    }

    if (useSegmentsView) {
      query = query.eq('rfm_segment', filters.segment)
    }

    query = query
      .order('last_order_date', { ascending: true, nullsFirst: true })
      .range(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize - 1)

    const { data, count, error } = await query

    if (error || !data) {
      return { success: false as const, error: error?.message || 'Ошибка загрузки' }
    }

    // Для ветки "Все" сегмент считаем на сервере (view с rfm_segment там не используется).
    const segmentConfig = useSegmentsView ? null : await loadSegmentConfig(adminSupabase)

    const clients = data.map((row: ClientListRow) => {
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

