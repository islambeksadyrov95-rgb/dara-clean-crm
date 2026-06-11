'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// WhatsApp-отправки пишутся как call_logs (sub_status = sent_whatsapp), но звонком
// НЕ являются — исключаются из «обзвонено/дозвонились» (как в queue/actions getDayStats).
const WHATSAPP_SUB_STATUS = 'sent_whatsapp'
const PAGE_SIZE = 1000 // постраничная выборка client_id для уникальных множеств

export type PipelinePeriod = {
  dateFrom?: string // YYYY-MM-DD
  dateTo?: string   // YYYY-MM-DD
}

export type PipelineFunnel = {
  totalClients: number       // вся база (за всё время, без периода)
  withOrderHistory: number   // клиенты с историей заказов (за всё время)
  called: number             // уникальные обзвоненные за период
  reached: number            // уникальные дозвонившиеся за период
  ordered: number            // уникальные клиенты с заказом за период
  totalCallsCount: number    // всего звонков за период (без WhatsApp)
  reachedCallsCount: number  // успешных звонков за период
  totalOrdersCount: number   // всего заказов за период
  totalRevenue: number       // выручка по заказам за период (tenge)
  avgCheck: number
}

export type ManagerFunnelRow = {
  managerId: string
  name: string
  calls: number
  reached: number
  orders: number
  conversion: number // % = orders / reached
}

type PeriodBounds = { from: string | null; to: string | null }

// Границы периода в ISO (UTC). Конец дня включительно.
function periodBounds(period: PipelinePeriod): PeriodBounds {
  const from = period.dateFrom ? new Date(period.dateFrom).toISOString() : null
  let to: string | null = null
  if (period.dateTo) {
    const end = new Date(period.dateTo)
    end.setHours(23, 59, 59, 999)
    to = end.toISOString()
  }
  return { from, to }
}

// Постраничная выборка client_id из call_logs с фильтрами периода, исключая WhatsApp.
// Возвращает Set уникальных client_id (всех, либо только status=reached).
async function fetchUniqueClientIds(
  admin: ReturnType<typeof createAdminClient>,
  bounds: PeriodBounds,
  reachedOnly: boolean,
): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  for (;;) {
    let query = admin
      .from('call_logs')
      .select('client_id')
      .or(`sub_status.is.null,sub_status.neq.${WHATSAPP_SUB_STATUS}`)
      .range(offset, offset + PAGE_SIZE - 1)

    if (reachedOnly) query = query.eq('status', 'reached')
    if (bounds.from) query = query.gte('created_at', bounds.from)
    if (bounds.to) query = query.lte('created_at', bounds.to)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.client_id) ids.add(row.client_id)
    }
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return ids
}

// Уникальные клиенты с заказом + выручка за период (постранично, снимает потолок 1000).
async function fetchOrderedClientsAndRevenue(
  admin: ReturnType<typeof createAdminClient>,
  bounds: PeriodBounds,
): Promise<{ orderedSet: Set<string>; totalRevenue: number }> {
  const orderedSet = new Set<string>()
  let totalRevenue = 0
  let offset = 0
  for (;;) {
    let query = admin
      .from('orders')
      .select('client_id, amount')
      .range(offset, offset + PAGE_SIZE - 1)
    if (bounds.from) query = query.gte('created_at', bounds.from)
    if (bounds.to) query = query.lte('created_at', bounds.to)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const row of data) {
      if (row.client_id) orderedSet.add(row.client_id)
      totalRevenue += Number(row.amount) || 0
    }
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return { orderedSet, totalRevenue }
}

export async function getPipelineFunnel(period: PipelinePeriod): Promise<PipelineFunnel> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const admin = createAdminClient()
  const bounds = periodBounds(period)

  // «База» — весь объём клиентов (без периода). count exact снимает потолок 1000.
  const totalClientsRes = await admin
    .from('clients')
    .select('id', { count: 'exact', head: true })
  if (totalClientsRes.error) throw new Error(totalClientsRes.error.message)

  // «С историей заказов» — за всё время, last_order_date IS NOT NULL.
  const withOrderHistoryRes = await admin
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .not('last_order_date', 'is', null)
  if (withOrderHistoryRes.error) throw new Error(withOrderHistoryRes.error.message)

  // Счётчики звонков за период (без WhatsApp) + заказов.
  let totalCallsQuery = admin
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .or(`sub_status.is.null,sub_status.neq.${WHATSAPP_SUB_STATUS}`)
  let reachedCallsQuery = admin
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'reached')
    .or(`sub_status.is.null,sub_status.neq.${WHATSAPP_SUB_STATUS}`)
  let ordersCountQuery = admin
    .from('orders')
    .select('id', { count: 'exact', head: true })

  if (bounds.from) {
    totalCallsQuery = totalCallsQuery.gte('created_at', bounds.from)
    reachedCallsQuery = reachedCallsQuery.gte('created_at', bounds.from)
    ordersCountQuery = ordersCountQuery.gte('created_at', bounds.from)
  }
  if (bounds.to) {
    totalCallsQuery = totalCallsQuery.lte('created_at', bounds.to)
    reachedCallsQuery = reachedCallsQuery.lte('created_at', bounds.to)
    ordersCountQuery = ordersCountQuery.lte('created_at', bounds.to)
  }

  const [calledSet, reachedSet, ordered, totalCallsRes, reachedCallsRes, ordersCountRes] =
    await Promise.all([
      fetchUniqueClientIds(admin, bounds, false),
      fetchUniqueClientIds(admin, bounds, true),
      fetchOrderedClientsAndRevenue(admin, bounds),
      totalCallsQuery,
      reachedCallsQuery,
      ordersCountQuery,
    ])

  if (totalCallsRes.error) throw new Error(totalCallsRes.error.message)
  if (reachedCallsRes.error) throw new Error(reachedCallsRes.error.message)
  if (ordersCountRes.error) throw new Error(ordersCountRes.error.message)

  const totalOrdersCount = ordersCountRes.count ?? 0
  const avgCheck = totalOrdersCount > 0 ? Math.round(ordered.totalRevenue / totalOrdersCount) : 0

  return {
    totalClients: totalClientsRes.count ?? 0,
    withOrderHistory: withOrderHistoryRes.count ?? 0,
    called: calledSet.size,
    reached: reachedSet.size,
    ordered: ordered.orderedSet.size,
    totalCallsCount: totalCallsRes.count ?? 0,
    reachedCallsCount: reachedCallsRes.count ?? 0,
    totalOrdersCount,
    totalRevenue: ordered.totalRevenue,
    avgCheck,
  }
}

// Разрез по менеджерам: звонки/дозвоны/заказы/конверсия за период.
export async function getPipelineByManager(period: PipelinePeriod): Promise<ManagerFunnelRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const admin = createAdminClient()
  const bounds = periodBounds(period)

  // Имена менеджеров из auth (как getUserNames в clients/actions).
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers()
  if (usersError) throw new Error(usersError.message)
  const nameById = new Map<string, string>()
  for (const u of usersData?.users ?? []) {
    const raw = u.user_metadata?.name || u.email?.split('@')[0] || 'Без имени'
    nameById.set(u.id, raw.charAt(0).toUpperCase() + raw.slice(1))
  }

  const stats = new Map<string, { calls: number; reached: number; orders: number }>()
  const ensure = (id: string) => {
    let row = stats.get(id)
    if (!row) {
      row = { calls: 0, reached: 0, orders: 0 }
      stats.set(id, row)
    }
    return row
  }

  await Promise.all([
    aggregateManagerCalls(admin, bounds, ensure),
    aggregateManagerOrders(admin, bounds, ensure),
  ])

  const rows: ManagerFunnelRow[] = []
  for (const [managerId, s] of stats) {
    rows.push({
      managerId,
      name: nameById.get(managerId) ?? 'Без имени',
      calls: s.calls,
      reached: s.reached,
      orders: s.orders,
      conversion: s.reached > 0 ? Math.round((s.orders / s.reached) * 1000) / 10 : 0,
    })
  }

  return rows.sort((a, b) => b.orders - a.orders || b.calls - a.calls)
}

type EnsureFn = (id: string) => { calls: number; reached: number; orders: number }

// Звонки за период (без WhatsApp), агрегируем по manager_id.
async function aggregateManagerCalls(
  admin: ReturnType<typeof createAdminClient>,
  bounds: PeriodBounds,
  ensure: EnsureFn,
): Promise<void> {
  let offset = 0
  for (;;) {
    let query = admin
      .from('call_logs')
      .select('manager_id, status')
      .or(`sub_status.is.null,sub_status.neq.${WHATSAPP_SUB_STATUS}`)
      .range(offset, offset + PAGE_SIZE - 1)
    if (bounds.from) query = query.gte('created_at', bounds.from)
    if (bounds.to) query = query.lte('created_at', bounds.to)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const row of data) {
      if (!row.manager_id) continue
      const s = ensure(row.manager_id)
      s.calls++
      if (row.status === 'reached') s.reached++
    }
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
}

// Заказы за период, агрегируем по manager_id.
async function aggregateManagerOrders(
  admin: ReturnType<typeof createAdminClient>,
  bounds: PeriodBounds,
  ensure: EnsureFn,
): Promise<void> {
  let offset = 0
  for (;;) {
    let query = admin
      .from('orders')
      .select('manager_id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (bounds.from) query = query.gte('created_at', bounds.from)
    if (bounds.to) query = query.lte('created_at', bounds.to)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const row of data) {
      if (!row.manager_id) continue
      ensure(row.manager_id).orders++
    }
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
}
