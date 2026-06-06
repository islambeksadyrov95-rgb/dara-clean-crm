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
  }
  config: MotivationConfig
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

export async function getManagerPerformance(): Promise<ManagerPerformance> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Пользователь не авторизован')
  }

  const { todayStart, monthStart } = getAlmatyDates()
  const email = user.email ?? ''

  // 1. Загружаем конфигурацию мотивации из Excel
  const config = getMotivationConfig(email)

  // 2. Звонки за сегодня
  const { data: todayCalls } = await supabase
    .from('call_logs')
    .select('status')
    .eq('manager_id', user.id)
    .gte('created_at', todayStart)

  // Звонки за месяц
  const { data: monthCalls } = await supabase
    .from('call_logs')
    .select('status')
    .eq('manager_id', user.id)
    .gte('created_at', monthStart)

  const todayCallsCount = todayCalls?.length ?? 0
  const todayReachedCount = todayCalls?.filter((c) => c.status === 'reached').length ?? 0

  const monthCallsCount = monthCalls?.length ?? 0
  const monthReachedCount = monthCalls?.filter((c) => c.status === 'reached').length ?? 0

  // 3. Заказы за сегодня
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('amount, discount_amount')
    .eq('manager_id', user.id)
    .gte('created_at', todayStart)

  const todayOrdersCount = todayOrders?.length ?? 0
  const todayRevenue = todayOrders?.reduce((sum, o) => sum + (Number(o.amount) - (Number(o.discount_amount) || 0)), 0) ?? 0

  // Заказы за месяц
  const { data: monthOrders } = await supabase
    .from('orders')
    .select('id, client_id, services, amount, discount_amount, created_at')
    .eq('manager_id', user.id)
    .gte('created_at', monthStart)

  const monthOrdersCount = monthOrders?.length ?? 0
  const monthRevenue = monthOrders?.reduce((sum, o) => sum + (Number(o.amount) - (Number(o.discount_amount) || 0)), 0) ?? 0

  // 4. Расчет KPI
  const avgCheck = monthOrdersCount > 0 ? monthRevenue / monthOrdersCount : 0
  const conversion = monthReachedCount > 0 ? (monthOrdersCount / monthReachedCount) * 100 : 0
  const crossSalesCount = monthOrders?.filter((o) => o.services && o.services.length >= 2).length ?? 0
  const crossSalesShare = monthOrdersCount > 0 ? (crossSalesCount / monthOrdersCount) * 100 : 0

  // 5. Распределение по категориям с проверкой на повторность заказов
  const categoryRevenue = {
    carpets: 0,
    furniture: 0,
    curtains: 0,
    repeat: 0,
  }

  if (monthOrders && monthOrders.length > 0) {
    const clientIds = Array.from(new Set(monthOrders.map((o) => o.client_id)))

    // Получаем ВСЕ заказы для этих клиентов
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

      if (isRepeat) {
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
    },
    config,
  }
}
