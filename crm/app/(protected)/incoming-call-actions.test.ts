import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  client: null as Record<string, unknown> | null,
  order: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const data = table === 'clients' ? state.client : state.order
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data, error: null }),
      }
      return b
    },
  }),
}))

import { getCallerCard } from './incoming-call-actions'

beforeEach(() => {
  state.user = { id: 'u1' }
  state.client = null
  state.order = null
})

describe('getCallerCard', () => {
  it('требует авторизации', async () => {
    state.user = null
    const res = await getCallerCard('c1')
    expect(res.success).toBe(false)
  })

  it('пустой clientId → ошибка', async () => {
    const res = await getCallerCard('')
    expect(res.success).toBe(false)
  })

  it('клиент не найден → client null, без заказа', async () => {
    state.client = null
    const res = await getCallerCard('c1')
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.client).toBeNull()
      expect(res.data.recentOrder).toBeNull()
    }
  })

  it('клиент + последний заказ', async () => {
    state.client = { id: 'c1', name: 'Иван', phone: '+77001112233', total_orders: 3, last_order_date: '2026-06-01' }
    state.order = { id: 'o1', agbis_doc_num: '000123', agbis_status_name: 'В исполнении', amount: 15000, created_at: '2026-06-20T10:00:00Z' }
    const res = await getCallerCard('c1')
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.client?.name).toBe('Иван')
      expect(res.data.client?.totalOrders).toBe(3)
      expect(res.data.recentOrder?.docNum).toBe('000123')
      expect(res.data.recentOrder?.statusName).toBe('В исполнении')
    }
  })
})
