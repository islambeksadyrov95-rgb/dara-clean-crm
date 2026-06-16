import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  state: { crm: null as unknown, hist: null as unknown, items: [] as unknown[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'orders' ? h.state.crm : table === 'order_history' ? h.state.hist : null,
            error: null,
          }),
          // order_items / order_history_items resolve to the items list when awaited
          then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
            resolve({ data: h.state.items, error: null }),
        }),
      }),
    }),
  }),
}))

import { getOrderDetail } from './order-detail'

beforeEach(() => {
  h.state.crm = null
  h.state.hist = null
  h.state.items = []
})

describe('getOrderDetail', () => {
  it('returns a CRM order when found in orders', async () => {
    h.state.crm = { id: 'o1', client_id: 'c1', client: { name: 'Иван' }, amount: 1000, intake_date: '2026-06-16', agbis_doc_num: '000267', agbis_order_id: '100279', agbis_status_name: 'Новый', delivery_date: null, comment: null, delivery_type: 'self', delivery_address: null, sync_status: 'synced' }
    h.state.items = [{ name: 'Табурет', qty: 1, unit_price: 1000, line_amount: 1000 }]
    const res = await getOrderDetail('o1')
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.source).toBe('crm')
      expect(res.data.docNum).toBe('000267')
      expect(res.data.items).toHaveLength(1)
    }
  })

  it('falls back to order_history when not a CRM order', async () => {
    h.state.hist = { id: 'h1', client_id: 'c2', client: null, amount: 5000, order_date: '2026-01-10', service: 'Ковёр', agbis_doc_num: '000100', agbis_dor_id: '99000', agbis_status_name: 'Выдан', agbis_date_out: null, agbis_user_name: 'Самал', address: null }
    const res = await getOrderDetail('h1')
    expect(res.success && res.data.source).toBe('history')
  })

  it('returns not-found when neither table has the id', async () => {
    const res = await getOrderDetail('zzz')
    expect(res.success).toBe(false)
  })
})
