import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  sendSpy: vi.fn(),
  claimed: [] as Array<Record<string, unknown>>,
  creators: [] as Array<{ id: string; created_by: string }>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: unknown) => {
      h.rpcSpy(fn, args)
      if (fn === 'claim_broadcast_recipients') return Promise.resolve({ data: h.claimed, error: null })
      return Promise.resolve({ data: null, error: null }) // settle_broadcast_recipient
    },
    from: () => ({ select: () => ({ in: async () => ({ data: h.creators, error: null }) }) }),
  }),
}))
vi.mock('@/lib/wazzup/send', () => ({ sendWhatsAppViaWazzup: h.sendSpy }))

import { drainBroadcasts } from './drain'

const noSleep = () => Promise.resolve()

beforeEach(() => {
  h.rpcSpy.mockReset()
  h.sendSpy.mockReset().mockResolvedValue({ success: true })
  h.claimed = []
  h.creators = []
})

describe('drainBroadcasts', () => {
  it('returns zeros and sends nothing when the queue is empty', async () => {
    const res = await drainBroadcasts(8, noSleep)
    expect(res).toEqual({ processed: 0, sent: 0, failed: 0 })
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it('sends each claimed recipient with the campaign creator as managerId and settles success', async () => {
    h.claimed = [{ id: 'r1', campaign_id: 'c1', client_id: 'cl1', phone: '+77001112233', message: 'Привет' }]
    h.creators = [{ id: 'c1', created_by: 'mgr-uuid' }]
    const res = await drainBroadcasts(8, noSleep)
    expect(res).toEqual({ processed: 1, sent: 1, failed: 0 })
    expect(h.sendSpy).toHaveBeenCalledWith({ phone: '+77001112233', text: 'Привет', managerId: 'mgr-uuid' })
    expect(h.rpcSpy).toHaveBeenCalledWith('settle_broadcast_recipient', { p_id: 'r1', p_success: true, p_error: undefined })
  })

  it('counts a failed send and settles it as failed with the error', async () => {
    h.claimed = [
      { id: 'r1', campaign_id: 'c1', client_id: null, phone: '+7700', message: 'a' },
      { id: 'r2', campaign_id: 'c1', client_id: null, phone: '+7701', message: 'b' },
    ]
    h.creators = [{ id: 'c1', created_by: 'm1' }]
    h.sendSpy.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'нет канала' })
    const res = await drainBroadcasts(8, noSleep)
    expect(res).toEqual({ processed: 2, sent: 1, failed: 1 })
    expect(h.rpcSpy).toHaveBeenCalledWith('settle_broadcast_recipient', { p_id: 'r2', p_success: false, p_error: 'нет канала' })
  })

  it('claims at most the given limit', async () => {
    await drainBroadcasts(5, noSleep)
    expect(h.rpcSpy).toHaveBeenCalledWith('claim_broadcast_recipients', { p_limit: 5, p_claimed_by: 'cron' })
  })
})
