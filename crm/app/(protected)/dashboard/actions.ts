'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/roles'

// ─── Константы ───
// WhatsApp-отправки пишутся в call_logs как sub_status='sent_whatsapp' и НЕ являются
// звонком — исключаются из счётчика звонков (тот же критерий, что в queue/getDayStats).
const WHATSAPP_SUB_STATUS = 'sent_whatsapp'
// Статусы «дозвонились» — менеджер поговорил с клиентом.
const REACHED_STATUSES = ['reached', 'callback'] as const
// До 5-го числа месяца данных мало — прогноз не показываем (риск из плана фазы).
const MIN_DAY_FOR_FORECAST = 5
// Рабочих дней в месяце по умолчанию (для темпа). Совпадает с getDayStats.
const WORKING_DAYS_PER_MONTH = 22
const ALMATY_OFFSET_MINUTES = 5 * 60 // UTC+5, без DST

// ─── Типы ───
export interface ManagerToday {
  managerId: string
  name: string
  email: string
  calls: number
  reached: number
  whatsapp: number
  orders: number
  revenue: number
}

export interface PlanFact {
  monthRevenue: number
  monthPlan: number
  planPercent: number
  hasEnoughData: boolean
  forecastRevenue: number
  forecastPercent: number
  dayOfMonth: number
  workingDaysPassed: number
  workingDaysTotal: number
}

export interface FunnelMini {
  base: number
  called: number
  reached: number
  orders: number
}

export interface LowScoreCall {
  id: string
  clientId: string
  clientName: string
  score: number
  createdAt: string
}

export interface DashboardData {
  today: ManagerToday[]
  planFact: PlanFact
  funnel: FunnelMini
  lowScoreCalls: LowScoreCall[]
}

// ─── Время (Almaty) ───
function getAlmatyContext() {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + ALMATY_OFFSET_MINUTES * 60000)

  const year = almatyNow.getFullYear()
  const month = almatyNow.getMonth() // 0-based
  const dayOfMonth = almatyNow.getDate()

  const todayStartUtc = new Date(
    new Date(year, month, dayOfMonth).getTime() - ALMATY_OFFSET_MINUTES * 60000,
  )
  const monthStartUtc = new Date(
    new Date(year, month, 1).getTime() - ALMATY_OFFSET_MINUTES * 60000,
  )

  return {
    todayStart: todayStartUtc.toISOString(),
    monthStart: monthStartUtc.toISOString(),
    year,
    monthNumber: month + 1, // 1-based для sales_plans
    dayOfMonth,
  }
}

// ─── 1. «Сегодня» по менеджерам ───
async function buildToday(
  supabase: Awaited<ReturnType<typeof createClient>>,
  todayStart: string,
): Promise<ManagerToday[]> {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, email')
    .neq('role', 'admin')

  if (profilesError || !profiles || profiles.length === 0) return []

  // Объёмы малы (3-5 менеджеров, звонков за день немного) — две лёгкие выборки за день.
  const [callsRes, ordersRes] = await Promise.all([
    supabase
      .from('call_logs')
      .select('manager_id, status, sub_status')
      .gte('created_at', todayStart),
    supabase
      .from('orders')
      .select('manager_id, amount, discount_amount')
      .gte('created_at', todayStart),
  ])

  const map = new Map<string, ManagerToday>()
  profiles.forEach((p) => {
    const name = (p.name || p.email?.split('@')[0] || 'Менеджер').trim()
    map.set(p.id, {
      managerId: p.id,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      email: p.email ?? '',
      calls: 0,
      reached: 0,
      whatsapp: 0,
      orders: 0,
      revenue: 0,
    })
  })

  ;(callsRes.data ?? []).forEach((c) => {
    const row = map.get(c.manager_id)
    if (!row) return
    if (c.sub_status === WHATSAPP_SUB_STATUS) {
      row.whatsapp++
      return
    }
    row.calls++
    if (c.status === 'reached' || c.status === 'callback') row.reached++
  })

  ;(ordersRes.data ?? []).forEach((o) => {
    const row = map.get(o.manager_id)
    if (!row) return
    row.orders++
    row.revenue += Number(o.amount) - (Number(o.discount_amount) || 0)
  })

  return Array.from(map.values())
    .map((r) => ({ ...r, revenue: Math.round(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)
}

// ─── 2. План-факт месяца + прогноз ───
async function buildPlanFact(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: ReturnType<typeof getAlmatyContext>,
): Promise<PlanFact> {
  // Факт: выручка месяца (orders). Объём заказов за месяц невелик — выборка amount допустима.
  const { data: monthOrders } = await supabase
    .from('orders')
    .select('amount, discount_amount')
    .gte('created_at', ctx.monthStart)

  const monthRevenue = Math.round(
    (monthOrders ?? []).reduce(
      (s, o) => s + (Number(o.amount) - (Number(o.discount_amount) || 0)),
      0,
    ),
  )

  // План отдела: сумма всех категорийных целей всех менеджеров за этот месяц/год.
  const { data: plans } = await supabase
    .from('sales_plans')
    .select(
      'carpets_target, furniture_target, curtains_target, repeat_target, dry_clean_target, blankets_target',
    )
    .eq('month', ctx.monthNumber)
    .eq('year', ctx.year)

  const monthPlan = (plans ?? []).reduce((sum, p) => {
    return (
      sum +
      (Number(p.carpets_target) || 0) +
      (Number(p.furniture_target) || 0) +
      (Number(p.curtains_target) || 0) +
      (Number(p.repeat_target) || 0) +
      (Number(p.dry_clean_target) || 0) +
      (Number(p.blankets_target) || 0)
    )
  }, 0)

  const planPercent = monthPlan > 0 ? Math.round((monthRevenue / monthPlan) * 100) : 0

  // Прогноз: текущий темп × рабочие дни месяца. До 5-го числа — «мало данных».
  const hasEnoughData = ctx.dayOfMonth >= MIN_DAY_FOR_FORECAST
  const workingDaysPassed = Math.min(ctx.dayOfMonth, WORKING_DAYS_PER_MONTH)
  const dailyRate = workingDaysPassed > 0 ? monthRevenue / workingDaysPassed : 0
  const forecastRevenue = Math.round(dailyRate * WORKING_DAYS_PER_MONTH)
  const forecastPercent = monthPlan > 0 ? Math.round((forecastRevenue / monthPlan) * 100) : 0

  return {
    monthRevenue,
    monthPlan,
    planPercent,
    hasEnoughData,
    forecastRevenue,
    forecastPercent,
    dayOfMonth: ctx.dayOfMonth,
    workingDaysPassed,
    workingDaysTotal: WORKING_DAYS_PER_MONTH,
  }
}

// ─── 3. Воронка-мини за месяц ───
async function buildFunnel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: ReturnType<typeof getAlmatyContext>,
): Promise<FunnelMini> {
  // База клиентов и заказы месяца — count-only (head), без выборок.
  const [baseRes, ordersRes] = await Promise.all([
    supabase.from('clients').select('id', { count: 'exact', head: true }),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', ctx.monthStart),
  ])

  // Уникальные клиенты из call_logs за месяц. Решение: выбираем только client_id+status
  // (компактные колонки) за месяц и считаем уникальные через Set в JS. Звонков мало
  // (десятки–сотни в месяц), порог риска (~5000 строк) не достигается, а count(distinct)
  // в Supabase REST недоступен.
  const { data: monthCalls } = await supabase
    .from('call_logs')
    .select('client_id, status, sub_status')
    .gte('created_at', ctx.monthStart)

  const calledSet = new Set<string>()
  const reachedSet = new Set<string>()
  ;(monthCalls ?? []).forEach((c) => {
    if (!c.client_id) return
    if (c.sub_status === WHATSAPP_SUB_STATUS) return // WhatsApp-отправка — не обзвон
    calledSet.add(c.client_id)
    if ((REACHED_STATUSES as readonly string[]).includes(c.status)) {
      reachedSet.add(c.client_id)
    }
  })

  return {
    base: baseRes.count ?? 0,
    called: calledSet.size,
    reached: reachedSet.size,
    orders: ordersRes.count ?? 0,
  }
}

// ─── 4. Качество: последние звонки с низкой оценкой ───
async function buildLowScoreCalls(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<LowScoreCall[]> {
  const { data } = await supabase
    .from('call_logs')
    .select('id, client_id, call_score, created_at, clients(name)')
    .lt('call_score', 6)
    .not('call_score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  return (data ?? []).map((row) => {
    const client = row.clients as { name: string | null } | null
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: client?.name ?? 'Без имени',
      score: Number(row.call_score) || 0,
      createdAt: row.created_at,
    }
  })
}

// ─── Точка входа ───
export async function getDashboardData(): Promise<DashboardData> {
  const auth = await requireAdmin()
  if (!auth.ok) throw new Error(auth.error)

  const supabase = await createClient()
  const ctx = getAlmatyContext()

  const [today, planFact, funnel, lowScoreCalls] = await Promise.all([
    buildToday(supabase, ctx.todayStart),
    buildPlanFact(supabase, ctx),
    buildFunnel(supabase, ctx),
    buildLowScoreCalls(supabase),
  ])

  return { today, planFact, funnel, lowScoreCalls }
}
