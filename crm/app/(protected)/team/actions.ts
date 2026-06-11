'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPrimaryWazzupKey, getSecondaryWazzupKey } from '@/lib/wazzup/keys'
import { WAZZUP_CHANNELS } from '@/lib/wazzup/config'

export interface ManagerLeaderboardItem {
  managerId: string
  email: string
  name: string
  role: string
  today: {
    calls: number
    reached: number
    orders: number
    revenue: number
  }
  month: {
    calls: number
    reached: number
    orders: number
    revenue: number
    conversion: number
  }
}

const ALMATY_OFFSET = 5 * 60 // UTC+5

function getAlmatyDates() {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + ALMATY_OFFSET * 60000)

  // Начало сегодняшнего дня
  const todayStart = new Date(almatyNow.getFullYear(), almatyNow.getMonth(), almatyNow.getDate())
  const todayUtc = new Date(todayStart.getTime() - ALMATY_OFFSET * 60000)

  // Начало текущего месяца
  const monthStart = new Date(almatyNow.getFullYear(), almatyNow.getMonth(), 1)
  const monthUtc = new Date(monthStart.getTime() - ALMATY_OFFSET * 60000)

  return {
    todayStart: todayUtc.toISOString(),
    monthStart: monthUtc.toISOString(),
  }
}

export async function getTeamPerformance(): Promise<ManagerLeaderboardItem[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Проверка прав администратора
  if (!user || user.app_metadata?.role !== 'admin') {
    throw new Error('Доступ запрещен. Требуются права администратора.')
  }

  const { todayStart, monthStart } = getAlmatyDates()

  // 1. Получаем список всех менеджеров из public.profiles
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, name, role')
    .neq('role', 'admin')

  if (profilesError || !profiles) {
    throw new Error(`Ошибка загрузки менеджеров: ${profilesError?.message || 'Неизвестная ошибка'}`)
  }

  // Синхронизируем всех сотрудников с обоими аккаунтами Wazzup
  try {
    const firstApiKey = getPrimaryWazzupKey()
    const secondApiKey = getSecondaryWazzupKey()
    const firstChannelId = WAZZUP_CHANNELS[0].id
    const secondChannelId = WAZZUP_CHANNELS[1].id

    const adminName = user.user_metadata?.name || user.email?.split('@')[0] || 'Администратор'

    // 1. Формируем пользователей для первого Wazzup (базовый ID и ID с суффиксом)
    const firstUsers = profiles.flatMap((m) => {
      const name = m.name || m.email?.split('@')[0] || 'Менеджер'
      return [
        { id: m.id, name },
        { id: `${m.id}_${firstChannelId}`, name }
      ]
    })
    firstUsers.push({ id: user.id, name: adminName })
    firstUsers.push({ id: `${user.id}_${firstChannelId}`, name: adminName })

    // 2. Формируем пользователей для второго Wazzup (базовый ID и ID с суффиксом)
    const secondUsers = profiles.flatMap((m) => {
      const name = m.name || m.email?.split('@')[0] || 'Менеджер'
      return [
        { id: m.id, name },
        { id: `${m.id}_${secondChannelId}`, name }
      ]
    })
    secondUsers.push({ id: user.id, name: adminName })
    secondUsers.push({ id: `${user.id}_${secondChannelId}`, name: adminName })

    // Отправляем в первый Wazzup
    await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firstApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(firstUsers),
    }).catch(e => console.error('First Wazzup sync error:', e))

    // Отправляем во второй Wazzup
    await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secondApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(secondUsers),
    }).catch(e => console.error('Second Wazzup sync error:', e))

  } catch (syncErr) {
    console.error('Failed to sync team to Wazzup:', syncErr)
  }

  const managers = profiles

  if (managers.length === 0) {
    return []
  }

  // 2. Звонки за сегодня
  const { data: todayCalls } = await supabase
    .from('call_logs')
    .select('manager_id, status')
    .gte('created_at', todayStart)

  // Звонки за месяц
  const { data: monthCalls } = await supabase
    .from('call_logs')
    .select('manager_id, status')
    .gte('created_at', monthStart)

  // 3. Заказы за сегодня
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('manager_id, amount, discount_amount')
    .gte('created_at', todayStart)

  // Заказы за месяц
  const { data: monthOrders } = await supabase
    .from('orders')
    .select('manager_id, amount, discount_amount')
    .gte('created_at', monthStart)

  // 4. Группируем и агрегируем
  const statsMap = new Map<string, Omit<ManagerLeaderboardItem, 'email' | 'name' | 'role' | 'managerId'>>()

  // Инициализируем карту для всех менеджеров
  managers.forEach((m) => {
    statsMap.set(m.id, {
      today: { calls: 0, reached: 0, orders: 0, revenue: 0 },
      month: { calls: 0, reached: 0, orders: 0, revenue: 0, conversion: 0 }
    })
  })

  // Агрегируем сегодняшние звонки
  todayCalls?.forEach((c) => {
    const stats = statsMap.get(c.manager_id)
    if (stats) {
      stats.today.calls++
      if (c.status === 'reached') stats.today.reached++
    }
  })

  // Агрегируем месячные звонки
  monthCalls?.forEach((c) => {
    const stats = statsMap.get(c.manager_id)
    if (stats) {
      stats.month.calls++
      if (c.status === 'reached') stats.month.reached++
    }
  })

  // Агрегируем сегодняшние заказы
  todayOrders?.forEach((o) => {
    const stats = statsMap.get(o.manager_id)
    if (stats) {
      stats.today.orders++
      stats.today.revenue += Number(o.amount) - (Number(o.discount_amount) || 0)
    }
  })

  // Агрегируем месячные заказы
  monthOrders?.forEach((o) => {
    const stats = statsMap.get(o.manager_id)
    if (stats) {
      stats.month.orders++
      stats.month.revenue += Number(o.amount) - (Number(o.discount_amount) || 0)
    }
  })

  // Вычисляем конверсию за месяц и формируем результат
  const leaderboard: ManagerLeaderboardItem[] = managers.map((m) => {
    const stats = statsMap.get(m.id) || {
      today: { calls: 0, reached: 0, orders: 0, revenue: 0 },
      month: { calls: 0, reached: 0, orders: 0, revenue: 0, conversion: 0 }
    }

    const conversion = stats.month.reached > 0 ? (stats.month.orders / stats.month.reached) * 100 : 0

    // Имя менеджера из метаданных или отрезаем от email
    const email = m.email ?? ''
    const name = m.name || email.split('@')[0]
    const role = m.role || 'manager'

    return {
      managerId: m.id,
      email,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      role,
      today: {
        calls: stats.today.calls,
        reached: stats.today.reached,
        orders: stats.today.orders,
        revenue: Math.round(stats.today.revenue),
      },
      month: {
        calls: stats.month.calls,
        reached: stats.month.reached,
        orders: stats.month.orders,
        revenue: Math.round(stats.month.revenue),
        conversion: Math.round(conversion * 10) / 10,
      }
    }
  })

  // Сортируем по месячной выручке (лидерборд)
  return leaderboard.sort((a, b) => b.month.revenue - a.month.revenue)
}

export async function createEmployee(payload: { email: string; name: string; role: 'manager' | 'admin'; password?: string }) {
  try {
    const supabase = await createClient()
    const { data: { user: currentUser } } = await supabase.auth.getUser()

    if (!currentUser || currentUser.app_metadata?.role !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    const { email, name, role, password } = payload
    if (!email || !name || !role || !password) {
      return { success: false as const, error: 'Все поля (Email, Имя, Роль, Пароль) обязательны' }
    }

    if (password.length < 6) {
      return { success: false as const, error: 'Пароль должен быть не менее 6 символов' }
    }

    const adminSupabase = createAdminClient()
    const { data, error } = await adminSupabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      // Роль — в app_metadata (пишется только service-role'ом, пользователь не может
      // переписать её сам). Имя остаётся в user_metadata.
      app_metadata: { role },
      user_metadata: { name: name.trim() }
    })

    if (error) {
      return { success: false as const, error: `Ошибка создания: ${error.message}` }
    }

    // Резервная ручная вставка в profiles на случай отсутствия триггера
    try {
      if (data?.user) {
        await supabase
          .from('profiles')
          .upsert({
            id: data.user.id,
            email: email.trim().toLowerCase(),
            name: name.trim(),
            role,
            updated_at: new Date().toISOString()
          })
      }
    } catch (dbErr: any) {
      console.warn('Не удалось записать профиль вручную:', dbErr.message)
    }

    // Синхронизируем созданного сотрудника с обоими аккаунтами Wazzup
    try {
      if (data?.user) {
        const firstApiKey = getPrimaryWazzupKey()
        const secondApiKey = getSecondaryWazzupKey()
        const firstChannelId = WAZZUP_CHANNELS[0].id
        const secondChannelId = WAZZUP_CHANNELS[1].id

        const employeeName = name.trim()

        // 1. Отправляем в первый Wazzup
        await fetch('https://api.wazzup24.com/v3/users', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firstApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            { id: data.user.id, name: employeeName },
            { id: `${data.user.id}_${firstChannelId}`, name: employeeName }
          ]),
        }).catch(e => console.error('First Wazzup single sync error:', e))

        // 2. Отправляем во второй Wazzup
        await fetch('https://api.wazzup24.com/v3/users', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${secondApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            { id: data.user.id, name: employeeName },
            { id: `${data.user.id}_${secondChannelId}`, name: employeeName }
          ]),
        }).catch(e => console.error('Second Wazzup single sync error:', e))
      }
    } catch (wazzupErr: any) {
      console.error('Wazzup sync error on employee create:', wazzupErr)
    }

    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

export async function getUnassignedClientsCount(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.app_metadata?.role !== 'admin') {
    throw new Error('Доступ запрещен. Требуются права администратора.')
  }

  const { count, error } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .is('assigned_manager_id', null)

  if (error) {
    console.error('Ошибка получения клиентов без ответственного:', error.message)
    return 0
  }

  return count ?? 0
}

export async function autoAssignUnassignedClients(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.app_metadata?.role !== 'admin') {
      return { success: false, count: 0, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    // 1. Получаем список всех активных менеджеров (роль не admin, is_active != false) из public.profiles
    const { data: managers, error: profilesError } = await supabase
      .from('profiles')
      .select('id')
      .neq('role', 'admin')
      .neq('is_active', false)

    if (profilesError || !managers || managers.length === 0) {
      return { success: false, count: 0, error: 'В системе нет активных менеджеров для распределения (проверьте настройки распределения).' }
    }

    // 2. Получаем всех клиентов без ответственного
    const { data: unassignedClients, error: clientsError } = await supabase
      .from('clients')
      .select('id')
      .is('assigned_manager_id', null)

    if (clientsError || !unassignedClients) {
      return { success: false, count: 0, error: `Ошибка получения клиентов: ${clientsError?.message}` }
    }

    if (unassignedClients.length === 0) {
      return { success: true, count: 0 }
    }

    const adminSupabase = createAdminClient()
    let managerIndex = 0
    const batchSize = 100
    let assignedCount = 0

    // Распределяем клиентов пачками
    for (let i = 0; i < unassignedClients.length; i += batchSize) {
      const batch = unassignedClients.slice(i, i + batchSize)
      const updates = batch.map((client) => {
        const managerId = managers[managerIndex].id
        managerIndex = (managerIndex + 1) % managers.length
        return {
          id: client.id,
          assigned_manager_id: managerId,
        }
      })

      // Делаем upsert
      const { error: upsertError } = await adminSupabase
        .from('clients')
        .upsert(updates, { onConflict: 'id' })

      if (upsertError) {
        console.error('Ошибка при пакетном распределении клиентов:', upsertError.message)
        return { success: false, count: assignedCount, error: `Ошибка распределения: ${upsertError.message}` }
      }

      assignedCount += batch.length
    }

    const { revalidatePath } = await import('next/cache')
    revalidatePath('/team')
    revalidatePath('/clients')
    revalidatePath('/queue')

    return { success: true, count: assignedCount }
  } catch (err: any) {
    return { success: false, count: 0, error: err.message || 'Внутренняя ошибка сервера' }
  }
}
