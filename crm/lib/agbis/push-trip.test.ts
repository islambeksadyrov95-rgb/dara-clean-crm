import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tripSpy: vi.fn(),
  updateSpy: vi.fn(),
  state: {
    order: { id: 'o1', client_id: 'c1', agbis_trip_id: null as string | null },
    client: { phone: '+77001112233', agbis_client_id: '555' } as { phone: string; agbis_client_id: string | null } | null,
  },
}))

vi.mock('@/lib/agbis/trips', async (orig) => ({
  ...(await orig<typeof import('./trips')>()),
  tripOrder: h.tripSpy,
}))
vi.mock('@/lib/agbis/managers', () => ({ getAgbisUserId: () => '1035' }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: table === 'orders' ? h.state.order : h.state.client }) }) }),
      update: (patch: unknown) => { h.updateSpy(patch); return { eq: async () => ({ error: null }) } },
    }),
  }),
}))

import { pushTripForOrder } from './push-trip'

const req = {
  type: 'pickup' as const, date: '17.06.2026', hr: '11:00', hrTo: '12:00',
  carId: '1023', address: 'ул. Абая 1', regionId: '1039', managerEmail: 'elena@daraclean.kz',
}

beforeEach(() => {
  h.state.order = { id: 'o1', client_id: 'c1', agbis_trip_id: null }
  h.state.client = { phone: '+77001112233', agbis_client_id: '555' }
  h.tripSpy.mockReset().mockResolvedValue({ tripId: '9001' })
  h.updateSpy.mockReset()
})

describe('pushTripForOrder', () => {
  it('creates the trip and mirrors trip fields onto the order', async () => {
    const res = await pushTripForOrder('o1', req)
    expect(res).toEqual({ ok: true, tripId: '9001' })
    expect(h.tripSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pickup', tel: '+77001112233', contrId: '555', userId: '1035', address: 'ул. Абая 1',
    }))
    expect(h.updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      agbis_trip_id: '9001', delivery_type: 'pickup', delivery_address: 'ул. Абая 1',
      region_id: '1039', agbis_car_id: '1023', trip_window_from: '11:00', trip_window_to: '12:00',
    }))
  })

  it('is idempotent when the order already has a trip', async () => {
    h.state.order = { id: 'o1', client_id: 'c1', agbis_trip_id: '777' }
    const res = await pushTripForOrder('o1', req)
    expect(res).toEqual({ ok: true, tripId: '777' })
    expect(h.tripSpy).not.toHaveBeenCalled()
  })

  it('returns ok:false when Agbis trip creation fails (order is not lost)', async () => {
    h.tripSpy.mockRejectedValueOnce(new Error('boom'))
    const res = await pushTripForOrder('o1', req)
    expect(res.ok).toBe(false)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })
})
