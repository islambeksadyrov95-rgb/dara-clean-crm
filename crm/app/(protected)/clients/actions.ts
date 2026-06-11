'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import { revalidatePath } from 'next/cache'

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

    if (user.user_metadata?.role !== 'admin') {
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
      .filter((u) => u.user_metadata?.role !== 'admin')
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

    if (user.user_metadata?.role !== 'admin') {
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

// Массовое назначение сегмента
export async function bulkAssignSegment(clientIds: string[], segment: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (user.user_metadata?.role !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    if (clientIds.length === 0) {
      return { success: true as const }
    }

    const { error } = await supabase
      .from('clients')
      .update({ rfm_segment: segment })
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

// Вспомогательная функция для расчета RFM-сегмента на сервере
function calculateRfmAndDays(totalOrders: number, lastOrderDateStr: string | null) {
  let rfmSegment = 'Новый'
  let daysSinceLastOrder: number | null = null

  if (lastOrderDateStr) {
    const lastOrderDate = new Date(lastOrderDateStr)
    const today = new Date()
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const orderDate = new Date(lastOrderDate.getFullYear(), lastOrderDate.getMonth(), lastOrderDate.getDate())
    const diffTime = todayDate.getTime() - orderDate.getTime()
    daysSinceLastOrder = Math.floor(diffTime / (1000 * 60 * 60 * 24))

    if (daysSinceLastOrder > 180) {
      rfmSegment = 'Потерянный'
    } else if (daysSinceLastOrder > 90) {
      rfmSegment = 'В риске'
    } else if (totalOrders >= 4) {
      rfmSegment = 'Постоянный'
    } else if (totalOrders >= 2) {
      rfmSegment = 'Повторный'
    } else {
      rfmSegment = 'Новый'
    }
  } else {
    if (totalOrders >= 4) {
      rfmSegment = 'Постоянный'
    } else if (totalOrders >= 2) {
      rfmSegment = 'Повторный'
    } else {
      rfmSegment = 'Новый'
    }
  }

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
    const { rfmSegment, daysSinceLastOrder } = calculateRfmAndDays(
      rawClient.total_orders,
      rawClient.last_order_date
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

    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`
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

    const clients = data.map((rawClient) => {
      let rfmSegment = (rawClient as any).rfm_segment
      let daysSinceLastOrder = (rawClient as any).days_since_last_order

      if (!useSegmentsView) {
        const calc = calculateRfmAndDays(
          rawClient.total_orders,
          rawClient.last_order_date
        )
        rfmSegment = calc.rfmSegment
        daysSinceLastOrder = calc.daysSinceLastOrder
      }

      return {
        id: rawClient.id,
        name: rawClient.name,
        phone: rawClient.phone,
        address: rawClient.address || null,
        total_orders: rawClient.total_orders,
        total_spent: Number(rawClient.total_spent) || 0,
        last_order_date: rawClient.last_order_date,
        assigned_manager_id: rawClient.assigned_manager_id,
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

