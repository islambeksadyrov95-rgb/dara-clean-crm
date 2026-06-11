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

const mockAdminClient = {
  from: vi.fn(() => ({ update: mockUpdate })),
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

    it('should return error when client is already locked', async () => {
      const fakeUser = { id: 'user-123' }
      mockUserClient.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })
      mockSingle.mockResolvedValue({ data: null, error: null })

      const { lockClient } = await import('@/app/(protected)/queue/actions')
      const result = await lockClient('client-1')

      expect(result).toEqual({ success: false, error: 'Клиент уже занят другим менеджером' })
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
