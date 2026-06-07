'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  if (!user || user.user_metadata?.role !== 'admin') {
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

    if (!currentUser || currentUser.user_metadata?.role !== 'admin') {
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
      user_metadata: { role, name: name.trim() }
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

    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}
