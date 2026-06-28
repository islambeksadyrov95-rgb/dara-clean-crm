import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  eqSpy: vi.fn(),
  result: { data: null as { agbis_user_id: string | null } | null },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => {
          h.eqSpy(col, val)
          return { maybeSingle: async () => h.result }
        },
      }),
    }),
  }),
}))

import { resolveAgbisUserId } from './managers'

beforeEach(() => {
  h.eqSpy.mockReset()
  h.result.data = null
})

describe('resolveAgbisUserId', () => {
  it('returns the profile agbis_user_id for a known email', async () => {
    h.result.data = { agbis_user_id: '1035' }
    expect(await resolveAgbisUserId('elena@daraclean.kz')).toBe('1035')
    expect(h.eqSpy).toHaveBeenCalledWith('email', 'elena@daraclean.kz')
  })

  it('lowercases and trims the email before lookup', async () => {
    h.result.data = { agbis_user_id: '1057' }
    await resolveAgbisUserId('  Admin@Dara.Clean ')
    expect(h.eqSpy).toHaveBeenCalledWith('email', 'admin@dara.clean')
  })

  it('returns null when the profile has no Agbis mapping (push falls back to API user)', async () => {
    h.result.data = { agbis_user_id: null }
    expect(await resolveAgbisUserId('manager1@daraclean.kz')).toBeNull()
  })

  it('returns null for an empty email WITHOUT hitting the DB', async () => {
    expect(await resolveAgbisUserId(null)).toBeNull()
    expect(await resolveAgbisUserId(undefined)).toBeNull()
    expect(await resolveAgbisUserId('')).toBeNull()
    expect(h.eqSpy).not.toHaveBeenCalled()
  })
})
