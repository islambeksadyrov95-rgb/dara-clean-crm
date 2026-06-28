import { describe, it, expect, beforeEach, vi } from 'vitest'
import { backoffSeconds, scladFromPayload, scladOutFromPayload } from './drain-orders'

const h = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  tripSpy: vi.fn(),
  rpcSpy: vi.fn(),
  claims: { order: [] as unknown[], trip: [] as unknown[] },
}))

vi.mock('@/lib/agbis/push-order', () => ({ pushOrderToAgbis: h.pushSpy }))
vi.mock('@/lib/agbis/push-trip', () => ({ pushTripForArm: h.tripSpy }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcSpy(fn, args)
      if (fn === 'claim_agbis_outbox') {
        const entity = args.p_entity as 'order' | 'trip'
        return Promise.resolve({ data: h.claims[entity], error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }),
}))

import { drainPendingOrders, drainPendingTrips } from './drain-orders'

beforeEach(() => {
  h.claims.order = []
  h.claims.trip = []
  h.pushSpy.mockReset()
  h.tripSpy.mockReset()
  h.rpcSpy.mockReset()
})

const settleCalls = () => h.rpcSpy.mock.calls.filter((c) => c[0] === 'settle_agbis_outbox').map((c) => c[1])

describe('backoffSeconds', () => {
  it('grows exponentially from the 60s base (within jitter)', () => {
    expect(backoffSeconds(1)).toBeGreaterThanOrEqual(60)
    expect(backoffSeconds(1)).toBeLessThanOrEqual(67)
    expect(backoffSeconds(2)).toBeGreaterThanOrEqual(120)
    expect(backoffSeconds(3)).toBeGreaterThanOrEqual(240)
  })
  it('caps at 6 hours', () => {
    expect(backoffSeconds(99)).toBeLessThanOrEqual(Math.round(6 * 60 * 60 * 1.1))
  })
})

describe('scladFromPayload', () => {
  it('reads a string sclad_id', () => expect(scladFromPayload({ sclad_id: '1023' })).toBe('1023'))
  it('returns undefined for a missing/non-string sclad_id', () => {
    expect(scladFromPayload({})).toBeUndefined()
    expect(scladFromPayload({ sclad_id: 5 })).toBeUndefined()
    expect(scladFromPayload(null)).toBeUndefined()
  })
})

describe('scladOutFromPayload', () => {
  it('reads a string sclad_out_id', () => expect(scladOutFromPayload({ sclad_out_id: '1032' })).toBe('1032'))
  it('returns undefined for legacy rows with only sclad_id', () => {
    expect(scladOutFromPayload({ sclad_id: '1023' })).toBeUndefined()
    expect(scladOutFromPayload({})).toBeUndefined()
    expect(scladOutFromPayload(null)).toBeUndefined()
  })
})

describe('drainPending Orders', () => {
  it('claims rows and settles each (success → ok, failure → backoff)', async () => {
    h.claims.order = [
      // Full frozen context → drain must re-push with the SAME date/manager/urgency, not defaults.
      { id: 'ob1', crm_id: 'o1', payload: { sclad_id: '1023', sclad_out_id: '1032', manager_email: 'elena@daraclean.kz', doc_date: '27.06.2026', date_out: '02.07.2026 10:00:00', fast_exec: '5' }, attempts: 1, max_attempts: 5 },
      { id: 'ob2', crm_id: 'o2', payload: { sclad_id: '1032' }, attempts: 1, max_attempts: 5 },
    ]
    h.pushSpy
      .mockResolvedValueOnce({ status: 'synced', dorId: '1' })
      .mockResolvedValueOnce({ status: 'pending', reason: 'agbis_push_failed' })
    const res = await drainPendingOrders(10)
    expect(res).toEqual({ processed: 2, synced: 1, pending: 1, dead: 0 })
    expect(h.pushSpy).toHaveBeenCalledWith('o1', { scladId: '1023', scladOutId: '1032', managerEmail: 'elena@daraclean.kz', docDate: '27.06.2026', dateOut: '02.07.2026 10:00:00', fastExec: '5' })
    // Legacy/minimal payload (only sclad_id) → context fields fall back to null (push uses defaults).
    expect(h.pushSpy).toHaveBeenCalledWith('o2', { scladId: '1032', scladOutId: undefined, managerEmail: null, docDate: undefined, dateOut: null, fastExec: null })
    const settles = settleCalls()
    expect(settles[0]).toMatchObject({ p_id: 'ob1', p_success: true })
    expect(settles[1]).toMatchObject({ p_id: 'ob2', p_success: false, p_error: 'agbis_push_failed' })
  })

  it('counts a row that exhausts max_attempts as dead', async () => {
    h.claims.order = [{ id: 'ob9', crm_id: 'o9', payload: {}, attempts: 5, max_attempts: 5 }]
    h.pushSpy.mockResolvedValue({ status: 'pending', reason: 'agbis_readback_unavailable' })
    const res = await drainPendingOrders(10)
    expect(res).toEqual({ processed: 1, synced: 0, pending: 0, dead: 1 })
    expect(settleCalls()[0]).toMatchObject({ p_id: 'ob9', p_success: false })
  })

  it('returns zeros when nothing is claimed', async () => {
    expect(await drainPendingOrders(10)).toEqual({ processed: 0, synced: 0, pending: 0, dead: 0 })
    expect(settleCalls()).toHaveLength(0)
  })
})

describe('drainPendingTrips', () => {
  it('claims arms and settles each by result', async () => {
    h.claims.trip = [
      { id: 'tb1', crm_id: 'o1', payload: { kind: 'pickup', address: 'ул. Абая 1', car_id: '1023' }, attempts: 1, max_attempts: 5 },
      { id: 'tb2', crm_id: 'o2', payload: { kind: 'delivery', address: 'ул. Сатпаева 2', car_id: '1032' }, attempts: 1, max_attempts: 5 },
    ]
    h.tripSpy.mockResolvedValueOnce({ ok: true, tripId: '9001' }).mockResolvedValueOnce({ ok: false, reason: 'no_slots' })
    const res = await drainPendingTrips(10)
    expect(res).toEqual({ processed: 2, synced: 1, pending: 1, dead: 0 })
    expect(h.tripSpy).toHaveBeenCalledWith('o1', { kind: 'pickup', address: 'ул. Абая 1', carId: '1023' }, { enqueueOnFailure: false })
    expect(settleCalls()[0]).toMatchObject({ p_id: 'tb1', p_success: true })
    expect(settleCalls()[1]).toMatchObject({ p_id: 'tb2', p_success: false, p_error: 'no_slots' })
  })

  it('settles a malformed payload as a failure without calling Agbis', async () => {
    h.claims.trip = [{ id: 'tb3', crm_id: 'o3', payload: { kind: 'bogus' }, attempts: 1, max_attempts: 5 }]
    const res = await drainPendingTrips(10)
    expect(h.tripSpy).not.toHaveBeenCalled()
    expect(res).toEqual({ processed: 1, synced: 0, pending: 1, dead: 0 })
    expect(settleCalls()[0]).toMatchObject({ p_id: 'tb3', p_success: false, p_error: 'malformed' })
  })
})
