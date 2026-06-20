import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above imports — spies must come from vi.hoisted to avoid TDZ.
const h = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  pushSpy: vi.fn(),
  tripSpy: vi.fn(),
  syncSpy: vi.fn(),
  slotsSpy: vi.fn(),
  updateSpy: vi.fn(),
  state: {
    user: undefined as unknown,
    rpcResult: { data: null as unknown, error: null as unknown },
    orderRow: { id: 'order-1' } as unknown,
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    rpc: h.rpcSpy,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.state.orderRow }) }) }) }),
  }),
}))

vi.mock('@/lib/agbis/push-order', () => ({ pushOrderToAgbis: h.pushSpy }))
vi.mock('@/lib/agbis/push-trip', () => ({ pushTripForArm: h.tripSpy, syncArm: h.syncSpy }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ update: (...args: unknown[]) => { h.updateSpy(...args); return { eq: async () => ({ error: null }) } } }),
  }),
}))

import { createOrder, updateOrderTrips } from './actions'

const validInput = {
  clientId: '11111111-1111-4111-8111-111111111111',
  items: [{ tovarId: '102419', name: 'Одеяло', qty: 2, unitPrice: 5000 }],
  scladId: '1023',
  scladOutId: '1023',
  deliveryAt: '2026-06-18T14:30', // выдача обязательна
}

beforeEach(() => {
  h.state.user = { id: 'u1' }
  h.state.rpcResult = { data: [{ order_id: 'order-1', created_at: '2026-06-16T00:00:00Z' }], error: null }
  h.rpcSpy.mockReset().mockImplementation(async () => h.state.rpcResult)
  h.pushSpy.mockReset().mockResolvedValue({ status: 'synced', dorId: '1032365' })
  h.tripSpy.mockReset().mockResolvedValue({ ok: true, tripId: '9001' })
  h.syncSpy.mockReset().mockResolvedValue({ ok: true, status: 'created', tripId: 'T1' })
  h.state.orderRow = { id: 'order-1' }
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
    expect(h.pushSpy).toHaveBeenCalledWith('order-1', expect.objectContaining({ scladId: '1023', scladOutId: '1023' }))
  })

  it('applies an order-level percent discount to the RPC and line items', async () => {
    await createOrder({ ...validInput, discountPercent: 10 })
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

  it('does not create a trip when both arms are самовывоз (self) and returns no trip ids', async () => {
    const res = await createOrder(validInput)
    expect(h.tripSpy).not.toHaveBeenCalled()
    expect(res.success && res.order.tripIds).toEqual([])
  })

  it('pushes the забор arm (pickup) and returns its synced trip id', async () => {
    const res = await createOrder({
      ...validInput, pickup: { mode: 'trip', address: 'ул. Абая 1', carId: '1023' },
    })
    expect(h.tripSpy).toHaveBeenCalledWith('order-1', { kind: 'pickup', address: 'ул. Абая 1', carId: '1023' })
    expect(res.success && res.order.tripIds).toEqual(['9001'])
  })

  it('pushes both arms independently (забор + выдача)', async () => {
    h.tripSpy.mockResolvedValueOnce({ ok: true, tripId: 'P1' }).mockResolvedValueOnce({ ok: true, tripId: 'D2' })
    const res = await createOrder({
      ...validInput,
      pickup: { mode: 'trip', address: 'ул. Абая 1', carId: '1023' },
      delivery: { mode: 'trip', address: 'ул. Сатпаева 2', carId: '1032' },
    })
    expect(h.tripSpy).toHaveBeenCalledTimes(2)
    expect(res.success && res.order.tripIds).toEqual(['P1', 'D2'])
  })

  it('a failed arm does not fail the order and is excluded from trip ids', async () => {
    h.tripSpy.mockResolvedValueOnce({ ok: false, reason: 'no_slots' })
    const res = await createOrder({
      ...validInput, pickup: { mode: 'trip', address: 'ул. Абая 1', carId: '1023' },
    })
    expect(res.success).toBe(true)
    expect(res.success && res.order.tripIds).toEqual([])
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

describe('updateOrderTrips', () => {
  const orderId = '11111111-1111-4111-8111-111111111111'
  const editInput = { orderId, pickup: { mode: 'trip', address: 'ул. Абая 1', carId: '1023' } }

  it('reconciles each arm via syncArm and returns the synced trip ids', async () => {
    h.syncSpy
      .mockResolvedValueOnce({ ok: true, status: 'created', tripId: 'P1' }) // pickup
      .mockResolvedValueOnce({ ok: true, status: 'unchanged' })             // delivery (default self)
    const res = await updateOrderTrips(editInput)
    expect(res).toEqual({ success: true, tripIds: ['P1'] })
    expect(h.syncSpy).toHaveBeenCalledWith(orderId, 'pickup', { mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(h.syncSpy).toHaveBeenCalledWith(orderId, 'delivery', { mode: 'self', address: '', carId: '' })
  })

  it('rejects unauthenticated', async () => {
    h.state.user = null
    const res = await updateOrderTrips(editInput)
    expect(res.success).toBe(false)
    expect(h.syncSpy).not.toHaveBeenCalled()
  })

  it('returns not-found (IDOR guard) when the order is not visible to the user', async () => {
    h.state.orderRow = null
    const res = await updateOrderTrips(editInput)
    expect(res).toEqual({ success: false, error: 'Заказ не найден' })
    expect(h.syncSpy).not.toHaveBeenCalled()
  })

  it('surfaces a partial failure when an arm does not reconcile', async () => {
    h.syncSpy.mockResolvedValueOnce({ ok: false, reason: 'edit_failed' })
    const res = await updateOrderTrips(editInput)
    expect(res.success).toBe(false)
  })

  it('persists edited забор/выдача dates before reconciling arms', async () => {
    await updateOrderTrips({ ...editInput, intakeDate: '2026-06-16T09:00', deliveryAt: '2026-06-19T14:00' })
    expect(h.updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      intake_date: '2026-06-16T09:00:00+05:00',
      delivery_date: '2026-06-19T14:00:00+05:00',
    }))
  })

  it('rejects invalid input (R2)', async () => {
    const res = await updateOrderTrips({ orderId: 'not-a-uuid' })
    expect(res.success).toBe(false)
    expect(h.syncSpy).not.toHaveBeenCalled()
  })
})
