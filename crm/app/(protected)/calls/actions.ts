'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type CommunicationEntry = {
  id: string
  type: 'call' | 'order'
  clientName: string
  clientPhone: string
  status: string
  subStatus: string | null
  reason: string | null
  notes: string | null
  amount: number | null
  managerEmail: string
  createdAt: string
}

export async function getCommunications(filters: {
  dateFrom?: string
  dateTo?: string
  status?: string
  type?: string
}): Promise<CommunicationEntry[]> {
  const supabase = await createClient()

  // Email менеджеров
  const adminSupabase = createAdminClient()
  const { data: usersData } = await adminSupabase.auth.admin.listUsers()
  const emailMap = new Map<string, string>()
  usersData?.users?.forEach((u) => emailMap.set(u.id, u.email ?? u.id.slice(0, 8)))

  const results: CommunicationEntry[] = []

  // Звонки
  if (!filters.type || filters.type === 'all' || filters.type === 'call') {
    let callQuery = supabase
      .from('call_logs')
      .select('id, status, sub_status, reason, notes, created_at, manager_id, clients!inner (name, phone)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filters.dateFrom) callQuery = callQuery.gte('created_at', filters.dateFrom)
    if (filters.dateTo) callQuery = callQuery.lte('created_at', filters.dateTo + 'T23:59:59')
    if (filters.status && filters.status !== 'all') callQuery = callQuery.eq('status', filters.status)

    const { data: calls } = await callQuery

    for (const row of (calls ?? []) as Record<string, unknown>[]) {
      const client = row.clients as Record<string, unknown> | null
      results.push({
        id: row.id as string,
        type: 'call',
        clientName: (client?.name as string) ?? 'Без имени',
        clientPhone: (client?.phone as string) ?? '',
        status: row.status as string,
        subStatus: row.sub_status as string | null,
        reason: row.reason as string | null,
        notes: row.notes as string | null,
        amount: null,
        managerEmail: emailMap.get(row.manager_id as string) ?? (row.manager_id as string).slice(0, 8),
        createdAt: row.created_at as string,
      })
    }
  }

  // Заказы
  if (!filters.type || filters.type === 'all' || filters.type === 'order') {
    let orderQuery = supabase
      .from('orders')
      .select('id, services, amount, discount_percent, comment, created_at, manager_id, clients!inner (name, phone)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (filters.dateFrom) orderQuery = orderQuery.gte('created_at', filters.dateFrom)
    if (filters.dateTo) orderQuery = orderQuery.lte('created_at', filters.dateTo + 'T23:59:59')

    const { data: orders } = await orderQuery

    for (const row of (orders ?? []) as Record<string, unknown>[]) {
      const client = row.clients as Record<string, unknown> | null
      const services = (row.services as string[]) ?? []
      results.push({
        id: row.id as string,
        type: 'order',
        clientName: (client?.name as string) ?? 'Без имени',
        clientPhone: (client?.phone as string) ?? '',
        status: 'order',
        subStatus: services.join(', '),
        reason: null,
        notes: row.comment as string | null,
        amount: row.amount as number | null,
        managerEmail: emailMap.get(row.manager_id as string) ?? (row.manager_id as string).slice(0, 8),
        createdAt: row.created_at as string,
      })
    }
  }

  // Сортировка по дате
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return results.slice(0, 200)
}
