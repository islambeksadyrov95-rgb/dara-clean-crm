import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tripSpy: vi.fn(),
  windowSpy: vi.fn(),
  upsertSpy: vi.fn(),
  outboxSpy: vi.fn(),
  deleteSpy: vi.fn(),
  state: {
    existingTrip: null as Record<string, unknown> | null,
    order: { id: 'o1', client_id: 'c1', manager_id: 'm1', intake_date: '2026-06-16', delivery_date: '2026-06-18T14:00:00+05:00', agbis_order_id: '100365' } as Record<string, unknown> | null,
    client: { phone: '+77001112233', agbis_client_id: '555' } as { phone: string | null; agbis_client_id: string | null } | null,
    profile: { agbis_user_id: '1035' } as { agbis_user_id: string | null } | null,
  },
}))

vi.mock('@/lib/agbis/trips', async (orig) => ({
  ...(await orig<typeof import('./trips')>()),
  tripOrder: h.tripSpy,
  widestTripWindow: h.windowSpy,
}))
vi.mock('@/lib/supabase/admin', () => {
  // Flexible chainable: select(...).eq().eq().maybeSingle() resolves per-table data;
  // delete()/upsert()/insert() are awaitable and spied. Any number of .eq() chained.
  const selectData = (table: string) =>
    table === 'order_trips' ? h.state.existingTrip
    : table === 'orders' ? h.state.order
    : table === 'clients' ? h.state.client
    : h.state.profile
  const makeChain = (data: unknown) => {
    const p = Promise.resolve({ data, error: null })
    const chain: Record<string, unknown> = {
      eq: () => chain,
      maybeSingle: async () => ({ data }),
      then: p.then.bind(p),
    }
    return chain
  }
  return {
    createAdminClient: () => ({
      from: (table: string) => ({
        select: () => makeChain(selectData(table)),
        upsert: (row: unknown, opts: unknown) => { h.upsertSpy(row, opts); return makeChain(null) },
        insert: (row: unknown) => { h.outboxSpy(row); return makeChain(null) },
        delete: () => { h.deleteSpy(table); return makeChain(null) },
      }),
    }),
  }
})

import { pushTripForArm, syncArm } from './push-trip'

const arm = { kind: 'pickup' as const, address: 'ул. Абая 1', carId: '1023' }

beforeEach(() => {
  h.state.existingTrip = null
  h.state.order = { id: 'o1', client_id: 'c1', manager_id: 'm1', intake_date: '2026-06-16', delivery_date: '2026-06-18T14:00:00+05:00', agbis_order_id: '100365' }
  h.state.client = { phone: '+77001112233', agbis_client_id: '555' }
  h.state.profile = { agbis_user_id: '1035' }
  h.tripSpy.mockReset().mockResolvedValue({ tripId: '9001' })
  h.windowSpy.mockReset().mockResolvedValue({ hr: '09:00', hrTo: '18:00' })
  h.upsertSpy.mockReset()
  h.outboxSpy.mockReset()
  h.deleteSpy.mockReset()
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

  it('refuses (order_not_synced) + enqueues when the order is not yet in Agbis (no orphan выезд)', async () => {
    h.state.order = { id: 'o1', client_id: 'c1', manager_id: 'm1', intake_date: '2026-06-16', delivery_date: null, agbis_order_id: null }
    const res = await pushTripForArm('o1', arm)
    expect(res).toEqual({ ok: false, reason: 'order_not_synced' })
    expect(h.tripSpy).not.toHaveBeenCalled()
    expect(h.outboxSpy).toHaveBeenCalledWith(expect.objectContaining({ entity: 'trip', crm_id: 'o1', op: 'create' }))
  })
})

const syncedRow = {
  agbis_trip_id: '9001', address: 'ул. Абая 1', agbis_car_id: '1023',
  window_from: '09:00', window_to: '18:00', trip_date: '2026-06-16',
}

describe('syncArm (Wave 2 edit)', () => {
  it('self + no existing trip → unchanged, no Agbis call', async () => {
    h.state.existingTrip = null
    const res = await syncArm('o1', 'pickup', { mode: 'self', address: '', carId: '' })
    expect(res).toEqual({ ok: true, status: 'unchanged' })
    expect(h.tripSpy).not.toHaveBeenCalled()
    expect(h.deleteSpy).not.toHaveBeenCalled()
  })

  it('trip + no existing row → creates the trip', async () => {
    h.state.existingTrip = null
    const res = await syncArm('o1', 'pickup', { mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(res).toMatchObject({ ok: true, status: 'created', tripId: '9001' })
    expect(h.tripSpy).toHaveBeenCalledWith(expect.not.objectContaining({ id: expect.anything() }))
  })

  it('trip + synced row, address changed → edits in Agbis (id + mp_status 0)', async () => {
    h.state.existingTrip = { ...syncedRow }
    const res = await syncArm('o1', 'pickup', { mode: 'trip', address: 'ул. Новая 5', carId: '1023' })
    expect(res).toMatchObject({ ok: true, status: 'edited', tripId: '9001' })
    expect(h.tripSpy).toHaveBeenCalledWith(expect.objectContaining({ id: '9001', mpStatus: '0', address: 'ул. Новая 5' }))
  })

  it('trip + synced row, nothing changed → unchanged, no Agbis call', async () => {
    h.state.existingTrip = { ...syncedRow }
    const res = await syncArm('o1', 'pickup', { mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(res).toMatchObject({ ok: true, status: 'unchanged', tripId: '9001' })
    expect(h.tripSpy).not.toHaveBeenCalled()
  })

  it('self + synced row → cancels in Agbis (mp_status 2) and drops the row', async () => {
    h.state.existingTrip = { ...syncedRow }
    const res = await syncArm('o1', 'pickup', { mode: 'self', address: '', carId: '' })
    expect(res).toEqual({ ok: true, status: 'cancelled' })
    expect(h.tripSpy).toHaveBeenCalledWith(expect.objectContaining({ id: '9001', mpStatus: '2' }))
    expect(h.deleteSpy).toHaveBeenCalledWith('order_trips')
  })
})
