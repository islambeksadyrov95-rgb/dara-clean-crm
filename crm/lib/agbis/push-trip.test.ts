import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tripSpy: vi.fn(),
  windowSpy: vi.fn(),
  upsertSpy: vi.fn(),
  outboxSpy: vi.fn(),
  state: {
    existingTrip: null as { agbis_trip_id: string | null } | null,
    order: { id: 'o1', client_id: 'c1', manager_id: 'm1', intake_date: '2026-06-16', delivery_date: '2026-06-18T14:00:00+05:00' } as Record<string, unknown> | null,
    client: { phone: '+77001112233', agbis_client_id: '555' } as { phone: string | null; agbis_client_id: string | null } | null,
    profile: { email: 'elena@daraclean.kz' } as { email: string } | null,
  },
}))

vi.mock('@/lib/agbis/trips', async (orig) => ({
  ...(await orig<typeof import('./trips')>()),
  tripOrder: h.tripSpy,
  widestTripWindow: h.windowSpy,
}))
vi.mock('@/lib/agbis/managers', () => ({ getAgbisUserId: () => '1035' }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.state.existingTrip }) }),
          maybeSingle: async () => ({
            data: table === 'orders' ? h.state.order : table === 'clients' ? h.state.client : h.state.profile,
          }),
        }),
      }),
      upsert: (row: unknown, opts: unknown) => { h.upsertSpy(row, opts); return Promise.resolve({ error: null }) },
      insert: (row: unknown) => { h.outboxSpy(row); return Promise.resolve({ error: null }) },
    }),
  }),
}))

import { pushTripForArm } from './push-trip'

const arm = { kind: 'pickup' as const, address: 'ул. Абая 1', carId: '1023' }

beforeEach(() => {
  h.state.existingTrip = null
  h.state.order = { id: 'o1', client_id: 'c1', manager_id: 'm1', intake_date: '2026-06-16', delivery_date: '2026-06-18T14:00:00+05:00' }
  h.state.client = { phone: '+77001112233', agbis_client_id: '555' }
  h.state.profile = { email: 'elena@daraclean.kz' }
  h.tripSpy.mockReset().mockResolvedValue({ tripId: '9001' })
  h.windowSpy.mockReset().mockResolvedValue({ hr: '09:00', hrTo: '18:00' })
  h.upsertSpy.mockReset()
  h.outboxSpy.mockReset()
})

describe('pushTripForArm', () => {
  it('creates a pickup trip (tp=1) on the intake date and writes a synced order_trips row', async () => {
    const res = await pushTripForArm('o1', arm)
    expect(res).toEqual({ ok: true, tripId: '9001' })
    expect(h.windowSpy).toHaveBeenCalledWith('16.06.2026', '1023')
    expect(h.tripSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pickup', date: '16.06.2026', hr: '09:00', hrTo: '18:00',
      tel: '+77001112233', contrId: '555', userId: '1035', address: 'ул. Абая 1',
    }))
    expect(h.upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'o1', kind: 'pickup', agbis_trip_id: '9001', sync_status: 'synced', sync_error: null }),
      { onConflict: 'order_id,kind' },
    )
    expect(h.outboxSpy).not.toHaveBeenCalled()
  })

  it('uses the delivery date for the delivery arm (tp=2)', async () => {
    await pushTripForArm('o1', { kind: 'delivery', address: 'A', carId: '1023' })
    expect(h.windowSpy).toHaveBeenCalledWith('18.06.2026', '1023')
    expect(h.tripSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'dropoff', date: '18.06.2026' }))
  })

  it('is idempotent when the arm already has a trip', async () => {
    h.state.existingTrip = { agbis_trip_id: '777' }
    const res = await pushTripForArm('o1', arm)
    expect(res).toEqual({ ok: true, tripId: '777' })
    expect(h.tripSpy).not.toHaveBeenCalled()
  })

  it('on Agbis failure marks the arm failed and enqueues a trip retry (order not lost)', async () => {
    h.tripSpy.mockRejectedValueOnce(new Error('boom'))
    const res = await pushTripForArm('o1', arm)
    expect(res).toEqual({ ok: false, reason: 'trip_failed' })
    expect(h.upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pickup', sync_status: 'failed', sync_error: 'trip_failed' }),
      { onConflict: 'order_id,kind' },
    )
    expect(h.outboxSpy).toHaveBeenCalledWith(expect.objectContaining({ entity: 'trip', crm_id: 'o1', op: 'create' }))
  })

  it('does NOT enqueue on failure when enqueueOnFailure is false (drain retries)', async () => {
    h.windowSpy.mockResolvedValueOnce(null) // no slots
    const res = await pushTripForArm('o1', arm, { enqueueOnFailure: false })
    expect(res).toEqual({ ok: false, reason: 'no_slots' })
    expect(h.outboxSpy).not.toHaveBeenCalled()
  })

  it('fails without writing a child row when the order is missing', async () => {
    h.state.order = null
    const res = await pushTripForArm('o1', arm)
    expect(res).toEqual({ ok: false, reason: 'order_not_found' })
    expect(h.upsertSpy).not.toHaveBeenCalled()
  })
})
