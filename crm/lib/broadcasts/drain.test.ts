import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  sendSpy: vi.fn(),
  claimed: [] as Array<Record<string, unknown>>,
  creators: [] as Array<{ id: string; created_by: string }>,
  lastClaimedAt: null as string | null, // wall-clock rate anchor (broadcast_recipients.claimed_at)
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: unknown) => {
      h.rpcSpy(fn, args)
      if (fn === 'claim_broadcast_recipients') return Promise.resolve({ data: h.claimed, error: null })
      return Promise.resolve({ data: null, error: null }) // settle_broadcast_recipient
    },
    from: (table: string) => {
      if (table === 'broadcast_recipients') {
        // lastClaimedAtMs chain: select().not().order().limit().maybeSingle()
        const row = h.lastClaimedAt ? { claimed_at: h.lastClaimedAt } : null
        const chain: Record<string, unknown> = {
          select: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: row, error: null }),
        }
        return chain
      }
      // broadcast_campaigns: loadCreators select().in()
      return { select: () => ({ in: async () => ({ data: h.creators, error: null }) }) }
    },
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
  // Far in the past → wall-clock budget sits at its cap (MAX_PER_RUN), so existing tests can send.
  h.lastClaimedAt = '2020-01-01T00:00:00.000Z'
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

  it('rate-gates the claim limit to the wall-clock budget (≤ MAX_PER_RUN), not the requested limit', async () => {
    await drainBroadcasts(5, noSleep)
    // requested 5, but the wall-clock budget caps it at MAX_PER_RUN (2)
    expect(h.rpcSpy).toHaveBeenCalledWith('claim_broadcast_recipients', { p_limit: 2, p_claimed_by: 'cron' })
  })

  it('sends nothing when the last claim was under a minute ago (rate gate closed)', async () => {
    h.lastClaimedAt = new Date(Date.now() - 5_000).toISOString() // 5s ago → budget 0
    h.claimed = [{ id: 'r1', campaign_id: 'c1', client_id: null, phone: '+7700', message: 'a' }]
    h.creators = [{ id: 'c1', created_by: 'm1' }]
    const res = await drainBroadcasts(8, noSleep)
    expect(res).toEqual({ processed: 0, sent: 0, failed: 0 })
    expect(h.sendSpy).not.toHaveBeenCalled()
    expect(h.rpcSpy).not.toHaveBeenCalledWith('claim_broadcast_recipients', expect.anything())
  })
})
