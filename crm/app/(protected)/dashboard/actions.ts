'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ManagerStats = {
  manager_id: string
  email: string
  calls: number
  reached: number
  orders: number
  revenue: number
}

export async function getTeamStats(): Promise<ManagerStats[]> {
  const supabase = await createClient()

  // Начало сегодняшнего дня (Asia/Almaty = UTC+5)
  const now = new Date()
  const almatyOffset = 5 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + almatyOffset * 60000)
  const todayStart = new Date(almatyNow.getFullYear(), almatyNow.getMonth(), almatyNow.getDate())
  const todayUtc = new Date(todayStart.getTime() - almatyOffset * 60000).toISOString()

  // Звонки за сегодня, группировка по менеджерам
  const { data: calls } = await supabase
    .from('call_logs')
    .select('manager_id, status')
    .gte('created_at', todayUtc)

  // Заказы за сегодня
  const { data: orders } = await supabase
    .from('orders')
    .select('manager_id, amount')
    .gte('created_at', todayUtc)

  // Собираем уникальных менеджеров
  const managerIds = new Set<string>()
  calls?.forEach((c) => managerIds.add(c.manager_id))
  orders?.forEach((o) => managerIds.add(o.manager_id))

  if (managerIds.size === 0) return []

  // Email менеджеров через admin API (service role)
  const adminSupabase = createAdminClient()
  const emailMap = new Map<string, string>()
  const { data: usersData } = await adminSupabase.auth.admin.listUsers()
  if (usersData?.users) {
    for (const u of usersData.users) {
      emailMap.set(u.id, u.email ?? u.id.slice(0, 8))
    }
  }

  const statsMap = new Map<string, ManagerStats>()

  for (const mid of managerIds) {
    statsMap.set(mid, {
      manager_id: mid,
      email: emailMap.get(mid) ?? mid.slice(0, 8) + '...',
      calls: 0,
      reached: 0,
      orders: 0,
      revenue: 0,
    })
  }

  calls?.forEach((c) => {
    const s = statsMap.get(c.manager_id)!
    s.calls++
    if (c.status === 'reached') s.reached++
  })

  orders?.forEach((o) => {
    const s = statsMap.get(o.manager_id)!
    s.orders++
    s.revenue += o.amount ?? 0
  })

  return Array.from(statsMap.values()).sort((a, b) => b.calls - a.calls)
}

export async function getTotalClients(): Promise<{ total: number; segments: Record<string, number> }> {
  const supabase = await createClient()

  const { count: total } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })

  const segments: Record<string, number> = {}
  for (const seg of ['Новый', 'Повторный', 'Постоянный', 'В риске', 'Потерянный']) {
    const { count } = await supabase
      .from('client_segments')
      .select('id', { count: 'exact', head: true })
      .eq('rfm_segment', seg)
    segments[seg] = count ?? 0
  }

  return { total: total ?? 0, segments }
}
