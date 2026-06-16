import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above imports — spies must come from vi.hoisted to avoid TDZ.
const h = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  pushSpy: vi.fn(),
  tripSpy: vi.fn(),
  slotsSpy: vi.fn(),
  updateSpy: vi.fn(),
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
vi.mock('@/lib/agbis/push-trip', () => ({ pushTripForOrder: h.tripSpy }))
vi.mock('@/lib/agbis/trips', () => ({ tripsHr: h.slotsSpy }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ update: (...args: unknown[]) => { h.updateSpy(...args); return { eq: async () => ({ error: null }) } } }),
  }),
}))

import { createOrder } from './actions'

const validInput = {
  clientId: '11111111-1111-4111-8111-111111111111',
  items: [{ tovarId: '102419', name: 'Одеяло', qty: 2, unitPrice: 5000 }],
  scladId: '1023',
  deliveryAt: '2026-06-18T14:30', // выдача обязательна
}

beforeEach(() => {
  h.state.user = { id: 'u1' }
  h.state.rpcResult = { data: [{ order_id: 'order-1', created_at: '2026-06-16T00:00:00Z' }], error: null }
  h.rpcSpy.mockReset().mockImplementation(async () => h.state.rpcResult)
  h.pushSpy.mockReset().mockResolvedValue({ status: 'synced', dorId: '1032365' })
  h.tripSpy.mockReset().mockResolvedValue({ ok: true, tripId: '9001' })
  h.slotsSpy.mockReset().mockResolvedValue(['11:00', '12:00'])
  h.updateSpy.mockReset()
})

describe('createOrder', () => {
  it('creates the order, pushes to Agbis, returns synced status', async () => {
    const res = await createOrder(validInput)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.order.amount).toBe(10000)
    expect(res.order.agbisStatus).toBe('synced')
    expect(res.order.dorId).toBe('1032365')
    expect(h.pushSpy).toHaveBeenCalledWith('order-1', expect.objectContaining({ scladId: '1023' }))
  })

  it('applies an order-level percent discount to the RPC and line items', async () => {
    await createOrder({ ...validInput, discountMode: 'percent', discountValue: 10 })
    const rpcArg = h.rpcSpy.mock.calls[0][1] as { p_amount: number; p_discount_percent: number; p_discount_amount: number; p_items: { discount_percent: number }[] }
    expect(rpcArg.p_amount).toBe(10000) // gross subtotal (2×5000)
    expect(rpcArg.p_discount_percent).toBe(10)
    expect(rpcArg.p_discount_amount).toBe(1000)
    expect(rpcArg.p_items[0].discount_percent).toBe(10) // per-service discount → Agbis
  })

  it('forwards intake/delivery dates and urgency to Agbis and persists them', async () => {
    await createOrder({ ...validInput, intakeDate: '2026-06-16T09:15', deliveryAt: '2026-06-18T14:30', fastExecId: '0' })
    expect(h.pushSpy).toHaveBeenCalledWith('order-1', expect.objectContaining({
      docDate: '16.06.2026', // Agbis doc_date — дата без времени (время приёмки Агбис ставит сам)
      dateOut: '18.06.2026 14:30:00',
    }))
    expect(h.updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      intake_date: '2026-06-16T09:15:00+05:00', // полное дата+время приёма хранится в CRM
      delivery_date: '2026-06-18T14:30:00+05:00',
      fast_exec_id: null,
    }))
  })

  it('defaults intake to the current Almaty datetime when omitted', async () => {
    await createOrder(validInput)
    const persisted = h.updateSpy.mock.calls[0]?.[0] as { intake_date?: string }
    expect(persisted.intake_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:00$/)
  })

  it('does not create a trip for самовывоз (self) and returns tripId=null', async () => {
    const res = await createOrder(validInput)
    expect(h.tripSpy).not.toHaveBeenCalled()
    expect(res.success && res.order.tripId).toBeNull()
  })

  it('creates a выезд (pickup) trip with the widest auto window and returns its id', async () => {
    const res = await createOrder({
      ...validInput, intakeDate: '2026-06-17T09:00', deliveryType: 'pickup',
      deliveryAddress: 'ул. Абая 1', carId: '1023',
    })
    // Окно подставляется самым широким свободным слотом дня (первый→последний из tripsHr); район не шлётся.
    expect(h.slotsSpy).toHaveBeenCalledWith('17.06.2026', '1023')
    expect(h.tripSpy).toHaveBeenCalledWith('order-1', expect.objectContaining({
      type: 'pickup', date: '17.06.2026', hr: '11:00', hrTo: '12:00', carId: '1023',
    }))
    expect(res.success && res.order.tripId).toBe('9001')
  })

  it('skips the trip (returns null) when Agbis has no free slots for the day', async () => {
    h.slotsSpy.mockResolvedValueOnce([])
    const res = await createOrder({
      ...validInput, intakeDate: '2026-06-17T09:00', deliveryType: 'pickup',
      deliveryAddress: 'ул. Абая 1', carId: '1023',
    })
    expect(h.tripSpy).not.toHaveBeenCalled()
    expect(res.success && res.order.tripId).toBeNull()
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
