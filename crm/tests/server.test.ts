import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// createClient() (server) builds a typed SSR client wired to Next's cookie store.
// These tests pin its contract: trimmed env + cookie adapter passed through.
const { createServerClientMock, cookieStore } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
  cookieStore: { getAll: vi.fn(() => []), set: vi.fn() },
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}))

import { createClient } from '@/lib/supabase/server'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  createServerClientMock.mockClear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = '  https://example.supabase.co  '
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '  anon-key  '
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('createClient (server)', () => {
  it('passes trimmed url/anon key and a cookie adapter', async () => {
    await createClient()

    expect(createServerClientMock).toHaveBeenCalledTimes(1)
    const [url, key, options] = createServerClientMock.mock.calls[0]
    expect(url).toBe('https://example.supabase.co')
    expect(key).toBe('anon-key')
    expect(typeof (options as { cookies: { getAll: unknown } }).cookies.getAll).toBe('function')
    expect(typeof (options as { cookies: { setAll: unknown } }).cookies.setAll).toBe('function')
  })

  it('cookie adapter reads from the Next cookie store', async () => {
    await createClient()
    const [, , options] = createServerClientMock.mock.calls[0]
    ;(options as { cookies: { getAll: () => unknown } }).cookies.getAll()
    expect(cookieStore.getAll).toHaveBeenCalled()
  })
})
