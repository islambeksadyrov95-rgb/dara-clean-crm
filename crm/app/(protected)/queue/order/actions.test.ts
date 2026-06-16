import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above imports — spies must come from vi.hoisted to avoid TDZ.
const h = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  pushSpy: vi.fn(),
  state: {
    user: undefined as unknown,
    rpcResult: { data: null as unknown, error: null as unknown },
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    rpc: h.rpcSpy,
  }),
}))

vi.mock('@/lib/agbis/push-order', () => ({ pushOrderToAgbis: h.pushSpy }))

import { createOrder } from './actions'

const validInput = {
  clientId: '11111111-1111-4111-8111-111111111111',
  items: [{ tovarId: '102419', name: 'Одеяло', qty: 2, unitPrice: 5000 }],
  scladId: '1023',
}

beforeEach(() => {
  h.state.user = { id: 'u1' }
  h.state.rpcResult = { data: [{ order_id: 'order-1', created_at: '2026-06-16T00:00:00Z' }], error: null }
  h.rpcSpy.mockReset().mockImplementation(async () => h.state.rpcResult)
  h.pushSpy.mockReset().mockResolvedValue({ status: 'synced', dorId: '1032365' })
})

describe('createOrder', () => {
  it('creates the order, pushes to Agbis, returns synced status', async () => {
    const res = await createOrder(validInput)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.order.amount).toBe(10000)
    expect(res.order.agbisStatus).toBe('synced')
    expect(res.order.dorId).toBe('1032365')
    expect(h.pushSpy).toHaveBeenCalledWith('order-1', '1023')
  })

  it('rejects invalid input without touching the db (R2)', async () => {
    const res = await createOrder({ ...validInput, items: [] })
    expect(res.success).toBe(false)
    expect(h.rpcSpy).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated', async () => {
    h.state.user = null
    const res = await createOrder(validInput)
    expect(res.success).toBe(false)
  })

  it('returns a generic message on rpc failure (R1)', async () => {
    h.state.rpcResult = { data: null, error: { message: 'relation "orders" ...' } }
    const res = await createOrder(validInput)
    expect(res.success).toBe(false)
    expect(res.success === false && /заказ/i.test(res.error)).toBe(true)
  })

  it('still succeeds (pending) when Agbis push is queued', async () => {
    h.pushSpy.mockResolvedValueOnce({ status: 'pending', reason: 'client_not_linked' })
    const res = await createOrder(validInput)
    expect(res.success && res.order.agbisStatus).toBe('pending')
  })
})
