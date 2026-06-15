import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => ({ data: h.row, error: null })
    chain.upsert = async (r: Record<string, unknown>) => {
      h.upserts.push(r)
      return { error: null }
    }
    return { from: () => chain }
  },
}))
vi.mock('@/lib/agbis/client', () => ({ rawLogin: vi.fn(), rawRefresh: vi.fn() }))

import { getValidSession } from '@/lib/agbis/session'
import { rawLogin, rawRefresh } from '@/lib/agbis/client'

const future = () => new Date(Date.now() + 3_600_000).toISOString()
const past = () => new Date(Date.now() - 3_600_000).toISOString()

beforeEach(() => {
  h.row = null
  h.upserts = []
  vi.clearAllMocks()
})

describe('getValidSession', () => {
  it('returns the stored session when still valid (no network)', async () => {
    h.row = { session_id: 'S-fresh', expires_at: future(), refresh_id: 'R' }
    expect(await getValidSession()).toBe('S-fresh')
    expect(rawLogin).not.toHaveBeenCalled()
    expect(rawRefresh).not.toHaveBeenCalled()
  })

  it('refreshes via RefreshSession when expired, then stores the new session', async () => {
    h.row = { session_id: 'S-old', expires_at: past(), refresh_id: 'R-1' }
    ;(rawRefresh as Mock).mockResolvedValue({ sessionId: 'S-new', refreshId: 'R-2', userId: '1022' })
    expect(await getValidSession()).toBe('S-new')
    expect(rawRefresh).toHaveBeenCalledWith('R-1')
    expect(rawLogin).not.toHaveBeenCalled()
    expect(h.upserts.at(-1)).toMatchObject({ id: 1, session_id: 'S-new', refresh_id: 'R-2' })
  })

  it('falls back to full Login when there is no refresh_id', async () => {
    h.row = { session_id: null, expires_at: null, refresh_id: null }
    ;(rawLogin as Mock).mockResolvedValue({ sessionId: 'S-login', refreshId: 'R-x', userId: '1022' })
    expect(await getValidSession()).toBe('S-login')
    expect(rawLogin).toHaveBeenCalledTimes(1)
  })

  it('single-flights concurrent refreshes (one network refresh for parallel callers)', async () => {
    h.row = { session_id: 'S-old', expires_at: past(), refresh_id: 'R-1' }
    ;(rawRefresh as Mock).mockResolvedValue({ sessionId: 'S-new', refreshId: 'R-2', userId: '1022' })
    const [a, b] = await Promise.all([getValidSession(), getValidSession()])
    expect(a).toBe('S-new')
    expect(b).toBe('S-new')
    expect(rawRefresh).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh bypasses the stored session', async () => {
    h.row = { session_id: 'S-fresh', expires_at: future(), refresh_id: 'R-1' }
    ;(rawRefresh as Mock).mockResolvedValue({ sessionId: 'S-forced', refreshId: 'R-2', userId: '1022' })
    expect(await getValidSession({ forceRefresh: true })).toBe('S-forced')
    expect(rawRefresh).toHaveBeenCalledTimes(1)
  })
})
