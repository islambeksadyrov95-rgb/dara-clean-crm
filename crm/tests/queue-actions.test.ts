import { describe, it, expect, vi, beforeEach } from 'vitest'

// Auth проходит через user-клиент (createClient), запись — через admin-клиент
// (createAdminClient), который обходит RLS. Тесты мокают оба.
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockOr = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()

const mockUserClient = {
  auth: { getUser: vi.fn() },
}

const mockGetUserById = vi.fn()
const mockAdminClient = {
  from: vi.fn(() => ({ update: mockUpdate })),
  auth: { admin: { getUserById: mockGetUserById } },
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockUserClient)),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

describe('Queue Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminClient.from.mockReturnValue({ update: mockUpdate })
    mockUpdate.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ or: mockOr })
    mockOr.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ single: mockSingle })
  })

  describe('lockClient', () => {
    it('should return error when user is not authenticated', async () => {
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: null } })

      const { lockClient } = await import('@/app/(protected)/queue/actions')
      const result = await lockClient('some-client-id')

      expect(result).toEqual({ success: false, error: 'Не авторизован' })
    })

    it('should call update with locked_by and locked_until on success', async () => {
      const fakeUser = { id: 'user-123' }
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })
      mockSingle.mockResolvedValue({ data: { id: 'client-1' }, error: null })

      const { lockClient } = await import('@/app/(protected)/queue/actions')
      const result = await lockClient('client-1')

      expect(mockAdminClient.from).toHaveBeenCalledWith('clients')
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          locked_by: 'user-123',
        })
      )
      expect(result).toEqual({ success: true })
    })

    it('should return error with owner name and minutes left when client is locked', async () => {
      const fakeUser = { id: 'user-123' }
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })
      // Atomic update не захватывает лок → data: null.
      mockSingle.mockResolvedValue({ data: null, error: null })

      // Фолбэк-чтение текущего лока: select(locked_by, locked_until)→eq→single.
      const lockSelectSingle = vi.fn().mockResolvedValue({
        data: { locked_by: 'other-user', locked_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        error: null,
      })
      const lockSelectEq = vi.fn(() => ({ single: lockSelectSingle }))
      const lockSelect = vi.fn(() => ({ eq: lockSelectEq }))
      mockAdminClient.from.mockReturnValue({ update: mockUpdate, select: lockSelect })

      // Имя владельца лока.
      mockGetUserById.mockResolvedValue({ data: { user: { user_metadata: { name: 'Алия' } } }, error: null })

      const { lockClient } = await import('@/app/(protected)/queue/actions')
      const result = await lockClient('client-1')

      expect(result.success).toBe(false)
      if (result.success) throw new Error('expected failure')
      expect(result.error).toContain('Алия')
      expect(result.error).toMatch(/мин/)
    })
  })

  describe('snoozeClient', () => {
    it('should return error when user is not authenticated', async () => {
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: null } })

      const { snoozeClient } = await import('@/app/(protected)/queue/actions')
      const result = await snoozeClient('client-1', '30m')

      expect(result).toEqual({ success: false, error: 'Не авторизован' })
    })

    // Чейн snoozeClient: select(locked_by)→eq→single, затем update→eq.
    function setupSnoozeMocks(lockedBy: string | null) {
      const selectSingle = vi.fn().mockResolvedValue({ data: { locked_by: lockedBy }, error: null })
      const selectEq = vi.fn(() => ({ single: selectSingle }))
      const select = vi.fn(() => ({ eq: selectEq }))
      const updateEq = vi.fn().mockResolvedValue({ error: null })
      const update = vi.fn(() => ({ eq: updateEq }))
      mockAdminClient.from.mockReturnValue({ select, update })
      return { update }
    }

    it.each(['30m', '2h', 'tomorrow'] as const)(
      'writes a future next_action_at for until=%s and unlocks own lock',
      async (until) => {
        mockUserClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } } })
        const { update } = setupSnoozeMocks('user-123')

        const { snoozeClient } = await import('@/app/(protected)/queue/actions')
        const result = await snoozeClient('client-1', until)

        expect(result.success).toBe(true)
        const payload = update.mock.calls[0][0]
        // next_action_at в будущем
        expect(new Date(payload.next_action_at).getTime()).toBeGreaterThan(Date.now())
        // lock наш — снимаем
        expect(payload.locked_by).toBeNull()
        expect(payload.locked_until).toBeNull()
      }
    )

    it('does not touch the lock when it belongs to another manager', async () => {
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } } })
      const { update } = setupSnoozeMocks('someone-else')

      const { snoozeClient } = await import('@/app/(protected)/queue/actions')
      await snoozeClient('client-1', '2h')

      const payload = update.mock.calls[0][0]
      expect(payload.next_action_at).toBeDefined()
      expect('locked_by' in payload).toBe(false)
    })
  })

  // Логика фильтра очереди: клиент с next_action_at в будущем скрыт,
  // с наступившим/без — виден. Это та же предикатная логика, что в fetchQueue.
  describe('queue snooze filter', () => {
    const isVisible = (nextActionAt: string | null, nowMs: number) =>
      !nextActionAt || new Date(nextActionAt).getTime() <= nowMs

    it('hides a client snoozed into the future', () => {
      const now = Date.now()
      expect(isVisible(new Date(now + 60_000).toISOString(), now)).toBe(false)
    })

    it('shows a client whose snooze time has arrived', () => {
      const now = Date.now()
      expect(isVisible(new Date(now - 1_000).toISOString(), now)).toBe(true)
    })

    it('shows a client with no snooze set', () => {
      expect(isVisible(null, Date.now())).toBe(true)
    })
  })

  describe('unlockClient', () => {
    it('should return error when user is not authenticated', async () => {
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: null } })

      const { unlockClient } = await import('@/app/(protected)/queue/actions')
      const result = await unlockClient('some-client-id')

      expect(result).toEqual({ success: false, error: 'Не авторизован' })
    })

    it('should set locked_by and locked_until to null', async () => {
      const fakeUser = { id: 'user-123' }
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })

      // Для unlock цепочка: update → eq → eq → select → single
      const mockEq2 = vi.fn()
      mockEq.mockReturnValue({ eq: mockEq2 })
      mockEq2.mockReturnValue({ select: mockSelect })
      mockSingle.mockResolvedValue({ data: { id: 'client-1' }, error: null })

      const { unlockClient } = await import('@/app/(protected)/queue/actions')
      const result = await unlockClient('client-1')

      expect(mockUpdate).toHaveBeenCalledWith({
        locked_by: null,
        locked_until: null,
      })
      expect(result).toEqual({ success: true })
    })
  })
})
