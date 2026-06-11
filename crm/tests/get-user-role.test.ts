import { describe, it, expect } from 'vitest'
import type { User } from '@supabase/supabase-js'

// getUserRole is extracted to a server-free module so client components and
// middleware can import it without pulling in 'server-only' dependencies.
// Existing roles.test.ts covers the same function via @/lib/auth/roles (re-export).
// This file verifies the direct import path works independently.
import { getUserRole } from '@/lib/auth/get-user-role'

function makeUser(overrides: Partial<User>): User {
  return { id: 'u1', app_metadata: {}, user_metadata: {}, ...overrides } as User
}

describe('getUserRole (get-user-role direct import)', () => {
  it('returns null for null user', () => {
    expect(getUserRole(null)).toBeNull()
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

  it('returns null for unknown roles', () => {
    expect(getUserRole(makeUser({ app_metadata: { role: 'superuser' } }))).toBeNull()
  })
})
