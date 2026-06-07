'use server'

import { createClient } from '@/lib/supabase/server'
import { getMotivationConfig, type MotivationConfig } from '@/lib/motivation-excel'

export interface ManagerPerformance {
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
  }
  kpi: {
    conversion: number
    avgCheck: number
    crossSalesShare: number
  }
  categories: {
    carpets: number
    furniture: number
    curtains: number
    repeat: number
    dryClean: number
    blankets: number
  }
  config: MotivationConfig
}

const ALMATY_OFFSET = 5 * 60 // UTC+5

function getAlmatyDates(month?: number, year?: number) {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + ALMATY_OFFSET * 60000)

  // Выбранные или текущие месяц и год
  const currentMonth = month ?? (almatyNow.getMonth() + 1)
  const currentYear = year ?? almatyNow.getFullYear()

  // Начало сегодняшнего дня (всегда реальное сегодня)
  const todayStart = new Date(almatyNow.getFullYear(), almatyNow.getMonth(), almatyNow.getDate())
  const todayUtc = new Date(todayStart.getTime() - ALMATY_OFFSET * 60000)

  // Интервал выбранного месяца
  const monthStart = new Date(currentYear, currentMonth - 1, 1)
  const monthEnd = new Date(currentYear, currentMonth, 1, 0, 0, 0, -1) // Последний миг месяца

  const monthStartUtc = new Date(monthStart.getTime() - ALMATY_OFFSET * 60000)
  const monthEndUtc = new Date(monthEnd.getTime() - ALMATY_OFFSET * 60000)

  return {
    todayStart: todayUtc.toISOString(),
    monthStart: monthStartUtc.toISOString(),
    monthEnd: monthEndUtc.toISOString(),
  }
}

// Новый Server Action, принимающий месяц и год
export async function getMotivationStats(month?: number, year?: number): Promise<ManagerPerformance> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Пользователь не авторизован')
  }

  const { todayStart, monthStart, monthEnd } = getAlmatyDates(month, year)
  const email = user.email ?? ''

  // 1. Загружаем конфигурацию мотивации из Excel/БД за выбранный период
  const config = await getMotivationConfig(email, month, year)

  // 2. Звонки за сегодня (всегда реальное сегодня)
  const { data: todayCalls } = await supabase
    .from('call_logs')
    .select('status')
    .eq('manager_id', user.id)
    .gte('created_at', todayStart)

  // Звонки за выбранный месяц
  const { data: monthCalls } = await supabase
    .from('call_logs')
    .select('status')
    .eq('manager_id', user.id)
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)

  const todayCallsCount = todayCalls?.length ?? 0
  const todayReachedCount = todayCalls?.filter((c) => c.status === 'reached').length ?? 0

  const monthCallsCount = monthCalls?.length ?? 0
  const monthReachedCount = monthCalls?.filter((c) => c.status === 'reached').length ?? 0

  // 3. Заказы за сегодня (всегда реальное сегодня)
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('amount, discount_amount')
    .eq('manager_id', user.id)
    .gte('created_at', todayStart)

  const todayOrdersCount = todayOrders?.length ?? 0
  const todayRevenue = todayOrders?.reduce((sum, o) => sum + (Number(o.amount) - (Number(o.discount_amount) || 0)), 0) ?? 0

  // Заказы за выбранный месяц
  const { data: monthOrders } = await supabase
    .from('orders')
    .select('id, client_id, services, amount, discount_amount, created_at, comment')
    .eq('manager_id', user.id)
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)

  const monthOrdersCount = monthOrders?.length ?? 0
  const monthRevenue = monthOrders?.reduce((sum, o) => sum + (Number(o.amount) - (Number(o.discount_amount) || 0)), 0) ?? 0

  // 4. Расчет KPI
  const avgCheck = monthOrdersCount > 0 ? monthRevenue / monthOrdersCount : 0
  const conversion = monthReachedCount > 0 ? (monthOrdersCount / monthReachedCount) * 100 : 0
  const crossSalesCount = monthOrders?.filter((o) => o.services && o.services.length >= 2).length ?? 0
  const crossSalesShare = monthOrdersCount > 0 ? (crossSalesCount / monthOrdersCount) * 100 : 0

  // 5. Распределение по 6 категориям
  const categoryRevenue = {
    carpets: 0,
    furniture: 0,
    curtains: 0,
    repeat: 0,
    dryClean: 0,
    blankets: 0,
  }

  if (monthOrders && monthOrders.length > 0) {
    const clientIds = Array.from(new Set(monthOrders.map((o) => o.client_id)))

    // Получаем ВСЕ заказы для этих клиентов (без ограничения по дате, чтобы узнать, повторный ли клиент)
    const { data: allOrdersForClients } = await supabase
      .from('orders')
      .select('id, client_id, created_at')
      .in('client_id', clientIds)
      .order('created_at', { ascending: true })

    const clientOrdersMap = new Map<string, string[]>()
    allOrdersForClients?.forEach((o) => {
      if (!clientOrdersMap.has(o.client_id)) {
        clientOrdersMap.set(o.client_id, [])
      }
      clientOrdersMap.get(o.client_id)!.push(o.id)
    })

    monthOrders.forEach((o) => {
      const finalAmount = Number(o.amount) - (Number(o.discount_amount) || 0)
      const clientOrderIds = clientOrdersMap.get(o.client_id) ?? []
      const orderIndex = clientOrderIds.indexOf(o.id)
      
      const isRepeat = orderIndex > 0

      // Самовывоз (dryClean)
      const isDryClean = o.services.includes('Самовывоз') || (o.comment && o.comment.toLowerCase().includes('самовывоз'))
      
      // Пледы / Одеяла (blankets)
      const isBlanket = o.services.includes('Пледы / Одеяла') || o.services.includes('Пледы') || o.services.includes('Одеяла')

      if (isDryClean) {
        categoryRevenue.dryClean += finalAmount
      } else if (isBlanket) {
        categoryRevenue.blankets += finalAmount
      } else if (isRepeat) {
        categoryRevenue.repeat += finalAmount
      } else {
        const categories: ('carpets' | 'furniture' | 'curtains')[] = []
        if (o.services.includes('Ковры')) categories.push('carpets')
        if (o.services.includes('Шторы')) categories.push('curtains')
        if (o.services.includes('Мебель') || o.services.includes('Клининг')) categories.push('furniture')
        
        if (categories.length === 0) {
          categories.push('furniture')
        }

        const part = finalAmount / categories.length
        categories.forEach((cat) => {
          categoryRevenue[cat] += part
        })
      }
    })
  }

  return {
    today: {
      calls: todayCallsCount,
      reached: todayReachedCount,
      orders: todayOrdersCount,
      revenue: todayRevenue,
    },
    month: {
      calls: monthCallsCount,
      reached: monthReachedCount,
      orders: monthOrdersCount,
      revenue: monthRevenue,
    },
    kpi: {
      conversion,
      avgCheck,
      crossSalesShare,
    },
    categories: {
      carpets: Math.round(categoryRevenue.carpets),
      furniture: Math.round(categoryRevenue.furniture),
      curtains: Math.round(categoryRevenue.curtains),
      repeat: Math.round(categoryRevenue.repeat),
      dryClean: Math.round(categoryRevenue.dryClean),
      blankets: Math.round(categoryRevenue.blankets),
    },
    config,
  }
}

// Для обратной совместимости
export async function getManagerPerformance(): Promise<ManagerPerformance> {
  return getMotivationStats()
}
