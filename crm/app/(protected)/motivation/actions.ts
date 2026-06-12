'use server'

import { createClient } from '@/lib/supabase/server'
import { getMotivationConfig, type MotivationConfig } from '@/lib/motivation-excel'
import { getUserRole } from '@/lib/auth/get-user-role'
import { computeBonus, type CategoryRevenue } from '@/lib/motivation-formula'

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

interface OrderForCategory {
  id: string
  client_id: string
  services: string[] | null
  amount: number | string | null
  discount_amount: number | string | null
  comment: string | null
}

// Распределение выручки заказов по 6 категориям (та же логика, что в калькуляторе).
// clientOrdersMap: client_id → отсортированные по дате id заказов (для определения повторного клиента).
function distributeRevenueByCategory(
  orders: OrderForCategory[],
  clientOrdersMap: Map<string, string[]>
): CategoryRevenue {
  const categoryRevenue: CategoryRevenue = {
    carpets: 0,
    furniture: 0,
    curtains: 0,
    repeat: 0,
    dryClean: 0,
    blankets: 0,
  }

  orders.forEach((o) => {
    const finalAmount = Number(o.amount) - (Number(o.discount_amount) || 0)
    const services = o.services ?? []
    const clientOrderIds = clientOrdersMap.get(o.client_id) ?? []
    const isRepeat = clientOrderIds.indexOf(o.id) > 0

    const isDryClean =
      services.includes('Самовывоз') ||
      (o.comment ? o.comment.toLowerCase().includes('самовывоз') : false)
    const isBlanket =
      services.includes('Пледы / Одеяла') ||
      services.includes('Пледы') ||
      services.includes('Одеяла')

    if (isDryClean) {
      categoryRevenue.dryClean += finalAmount
    } else if (isBlanket) {
      categoryRevenue.blankets += finalAmount
    } else if (isRepeat) {
      categoryRevenue.repeat += finalAmount
    } else {
      const cats: ('carpets' | 'furniture' | 'curtains')[] = []
      if (services.includes('Ковры')) cats.push('carpets')
      if (services.includes('Шторы')) cats.push('curtains')
      if (services.includes('Мебель') || services.includes('Клининг')) cats.push('furniture')
      if (cats.length === 0) cats.push('furniture')

      const part = finalAmount / cats.length
      cats.forEach((cat) => {
        categoryRevenue[cat] += part
      })
    }
  })

  return {
    carpets: Math.round(categoryRevenue.carpets),
    furniture: Math.round(categoryRevenue.furniture),
    curtains: Math.round(categoryRevenue.curtains),
    repeat: Math.round(categoryRevenue.repeat),
    dryClean: Math.round(categoryRevenue.dryClean),
    blankets: Math.round(categoryRevenue.blankets),
  }
}

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

  // 5. Распределение по 6 категориям (единый helper)
  let categories: CategoryRevenue = {
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

    categories = distributeRevenueByCategory(monthOrders, clientOrdersMap)
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
    categories,
    config,
  }
}

// Для обратной совместимости
export async function getManagerPerformance(): Promise<ManagerPerformance> {
  return getMotivationStats()
}

// ─── Ведомость бонусов (режим админа) ──────────────────────────────────────

export interface BonusPayrollRow {
  managerId: string
  name: string
  email: string
  revenue: CategoryRevenue
  totalRevenue: number
  totalPayout: number
  isJackpotEarned: boolean
  /** Средний % выполнения планов (для строк без денег) */
  avgAchievement: number
  /** Есть ли заданные планы у менеджера на месяц */
  hasPlans: boolean
}

export interface BonusPayroll {
  rows: BonusPayrollRow[]
  totalPayout: number
  totalRevenue: number
  /** Хотя бы у одного менеджера есть выручка за месяц */
  hasRevenue: boolean
}

export async function getBonusesPayroll(month: number, year: number): Promise<BonusPayroll> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    throw new Error('Доступ запрещён. Требуются права администратора.')
  }

  const { monthStart, monthEnd } = getAlmatyDates(month, year)

  // 1. Список менеджеров
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, email')
    .neq('role', 'admin')

  if (profilesError || !profiles) {
    console.error('[getBonusesPayroll] profiles', profilesError?.message)
    throw new Error('Не удалось загрузить список менеджеров')
  }

  const rows: BonusPayrollRow[] = []

  for (const profile of profiles) {
    const email = profile.email ?? ''
    const displayName = (profile.name || email.split('@')[0] || 'Без имени')
    const name = displayName.charAt(0).toUpperCase() + displayName.slice(1)

    // Конфиг (ставки, джекпот, планы менеджера на месяц)
    const config = await getMotivationConfig(email, month, year)

    // Заказы менеджера за месяц
    const { data: monthOrders } = await supabase
      .from('orders')
      .select('id, client_id, services, amount, discount_amount, comment')
      .eq('manager_id', profile.id)
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd)

    let revenue: CategoryRevenue = {
      carpets: 0,
      furniture: 0,
      curtains: 0,
      repeat: 0,
      dryClean: 0,
      blankets: 0,
    }

    if (monthOrders && monthOrders.length > 0) {
      const clientIds = Array.from(new Set(monthOrders.map((o) => o.client_id)))
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

      revenue = distributeRevenueByCategory(monthOrders, clientOrdersMap)
    }

    const result = computeBonus({
      revenue,
      plans: config.plans,
      rates: config.rates,
      jackpot: config.jackpot,
    })

    const hasPlans = Object.values(config.plans).some((v) => v > 0)

    rows.push({
      managerId: profile.id,
      name,
      email,
      revenue,
      totalRevenue: result.totalRevenue,
      totalPayout: result.totalPayout,
      isJackpotEarned: result.isJackpotEarned,
      avgAchievement: result.avgAchievement,
      hasPlans,
    })
  }

  rows.sort((a, b) => b.totalPayout - a.totalPayout || a.name.localeCompare(b.name, 'ru'))

  const totalPayout = rows.reduce((sum, r) => sum + r.totalPayout, 0)
  const totalRevenue = rows.reduce((sum, r) => sum + r.totalRevenue, 0)
  const hasRevenue = totalRevenue > 0

  return { rows, totalPayout, totalRevenue, hasRevenue }
}
