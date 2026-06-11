import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// createAdminClient() builds a typed service-role client. These tests pin its
// contract: env validation + that it returns a usable PostgREST query builder.
const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ from: vi.fn() })),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

import { createAdminClient } from '@/lib/supabase/admin'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  createClientMock.mockClear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('createAdminClient', () => {
  it('passes trimmed url and service-role key with session disabled', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '  https://example.supabase.co  '
    process.env.SUPABASE_SERVICE_ROLE_KEY = '  service-role-key  '

    createAdminClient()

    expect(createClientMock).toHaveBeenCalledTimes(1)
    const [url, key, options] = createClientMock.mock.calls[0]
    expect(url).toBe('https://example.supabase.co')
    expect(key).toBe('service-role-key')
    expect(options).toMatchObject({
      auth: { autoRefreshToken: false, persistSession: false },
    })
  })

  it('throws when url is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    expect(() => createAdminClient()).toThrow()
  })

  it('throws when service-role key is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => createAdminClient()).toThrow()
  })
})
