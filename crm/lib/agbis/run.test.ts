import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

vi.mock('@/lib/agbis/session', () => ({ getValidSession: vi.fn() }))

import { withUserSession } from '@/lib/agbis/run'
import { getValidSession } from '@/lib/agbis/session'
import { AgbisSessionExpiredError, AgbisError } from '@/lib/agbis/client'

beforeEach(() => vi.clearAllMocks())

describe('withUserSession', () => {
  it('runs the command with the current session and returns its result', async () => {
    ;(getValidSession as Mock).mockResolvedValue('S-1')
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withUserSession(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledWith('S-1')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('refreshes once and retries on a session-expired (error:3) failure', async () => {
    ;(getValidSession as Mock).mockResolvedValueOnce('S-stale').mockResolvedValueOnce('S-fresh')
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AgbisSessionExpiredError())
      .mockResolvedValueOnce('ok-after-refresh')
    expect(await withUserSession(fn)).toBe('ok-after-refresh')
    expect(getValidSession).toHaveBeenNthCalledWith(2, { forceRefresh: true })
    expect(fn).toHaveBeenNthCalledWith(2, 'S-fresh')
  })

  it('does not retry on a non-session error', async () => {
    ;(getValidSession as Mock).mockResolvedValue('S-1')
    const fn = vi.fn().mockRejectedValue(new AgbisError(1, 'boom'))
    await expect(withUserSession(fn)).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
