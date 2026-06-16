import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  deleteSpy: vi.fn(),
  state: { rows: [] as { id: string; crm_id: string; payload: unknown }[] },
}))

vi.mock('@/lib/agbis/push-order', () => ({ pushOrderToAgbis: h.pushSpy }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: h.state.rows }) }) }) }),
      delete: () => ({ eq: (col: string, val: string) => { h.deleteSpy(val); return Promise.resolve({ error: null }) } }),
    }),
  }),
}))

import { drainPendingOrders } from './drain-orders'

beforeEach(() => {
  h.state.rows = []
  h.pushSpy.mockReset()
  h.deleteSpy.mockReset()
})

describe('drainPendingOrders', () => {
  it('pushes each queued order and removes the outbox row on success', async () => {
    h.state.rows = [
      { id: 'ob1', crm_id: 'o1', payload: { sclad_id: '1023' } },
      { id: 'ob2', crm_id: 'o2', payload: { sclad_id: '1032' } },
    ]
    h.pushSpy.mockResolvedValueOnce({ status: 'synced', dorId: '1' }).mockResolvedValueOnce({ status: 'pending', reason: 'x' })
    const res = await drainPendingOrders(10)
    expect(res).toEqual({ processed: 2, synced: 1, pending: 1 })
    expect(h.pushSpy).toHaveBeenCalledWith('o1', { scladId: '1023' })
    expect(h.deleteSpy).toHaveBeenCalledWith('ob1')
    expect(h.deleteSpy).not.toHaveBeenCalledWith('ob2')
  })

  it('passes undefined scladId when payload has none', async () => {
    h.state.rows = [{ id: 'ob3', crm_id: 'o3', payload: {} }]
    h.pushSpy.mockResolvedValue({ status: 'synced', dorId: '1' })
    await drainPendingOrders(10)
    expect(h.pushSpy).toHaveBeenCalledWith('o3', { scladId: undefined })
  })

  it('returns zeros when the queue is empty', async () => {
    expect(await drainPendingOrders(10)).toEqual({ processed: 0, synced: 0, pending: 0 })
  })
})
