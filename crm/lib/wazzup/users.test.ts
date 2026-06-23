import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/wazzup/keys', () => ({
  getPrimaryWazzupKey: () => 'key1',
  getSecondaryWazzupKey: () => 'key2',
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { syncWazzupUsersBothAccounts, syncWazzupUsersForKey } from '@/lib/wazzup/users'

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true, text: async () => '' })
})

describe('wazzup/users', () => {
  it('пушит стабильные id (без суффикса канала) в оба аккаунта', async () => {
    await syncWazzupUsersBothAccounts([{ id: 'u1', name: 'Самал' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as { body: string }).body)
      expect(body).toEqual([{ id: 'u1', name: 'Самал' }])
      // главный инвариант фикса: ни одного id с суффиксом «_<uuid-канала>»
      for (const u of body) expect(u.id).not.toMatch(/_[0-9a-f-]{36}$/)
    }
    const auth = fetchMock.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers.Authorization)
    expect(auth).toContain('Bearer key1')
    expect(auth).toContain('Bearer key2')
  })

  it('пустой список — без сетевых запросов', async () => {
    await syncWazzupUsersBothAccounts([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('syncWazzupUsersForKey шлёт ровно в один аккаунт', async () => {
    await syncWazzupUsersForKey('keyX', [{ id: 'u2', name: 'Елена' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer keyX')
  })

  it('не бросает при сбое Wazzup (best-effort)', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    await expect(syncWazzupUsersBothAccounts([{ id: 'u1', name: 'X' }])).resolves.toBeUndefined()
  })
})
