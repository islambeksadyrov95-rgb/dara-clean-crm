import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { User } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))

import { getUserRole, requireAdmin } from '@/lib/auth/roles'

function makeUser(overrides: Partial<User>): User {
  return { id: 'u1', app_metadata: {}, user_metadata: {}, ...overrides } as User
}

describe('getUserRole', () => {
  it('returns null for null user', () => {
    expect(getUserRole(null)).toBe(null)
  })

  it('reads role from app_metadata', () => {
    expect(getUserRole(makeUser({ app_metadata: { role: 'admin' } }))).toBe('admin')
    expect(getUserRole(makeUser({ app_metadata: { role: 'manager' } }))).toBe('manager')
  })

  it('falls back to user_metadata when app_metadata has no role', () => {
    expect(
      getUserRole(makeUser({ app_metadata: {}, user_metadata: { role: 'manager' } }))
    ).toBe('manager')
  })

  it('prefers app_metadata over user_metadata', () => {
    expect(
      getUserRole(
        makeUser({ app_metadata: { role: 'admin' }, user_metadata: { role: 'manager' } })
      )
    ).toBe('admin')
  })

  it('returns null for unknown roles', () => {
    expect(getUserRole(makeUser({ app_metadata: { role: 'superuser' } }))).toBe(null)
    expect(getUserRole(makeUser({ app_metadata: { role: '' } }))).toBe(null)
  })
})

describe('requireAdmin', () => {
  beforeEach(() => {
    state.user = null
  })

  it('returns error when no user', async () => {
    state.user = null
    const result = await requireAdmin()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Доступ запрещен. Требуются права администратора.')
    }
  })

  it('returns error when user is not admin', async () => {
    state.user = { id: 'u1', app_metadata: { role: 'manager' }, user_metadata: {} }
    const result = await requireAdmin()
    expect(result.ok).toBe(false)
  })

  it('returns ok with user when admin', async () => {
    state.user = { id: 'u1', app_metadata: { role: 'admin' }, user_metadata: {} }
    const result = await requireAdmin()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.id).toBe('u1')
    }
  })
})
