import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const adminTables: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {}

function makeTable(rows: { list?: Record<string, unknown>[] }) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {}
  const chain = () => vi.fn(() => b)
  b.select = chain()
  b.insert = vi.fn(() => Promise.resolve({ error: null }))
  b.update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }))
  b.eq = chain()
  b.is = chain()
  b.not = chain()
  b.order = vi.fn(() => Promise.resolve({ data: rows.list ?? [], error: null }))
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn((t: string) => adminTables[t]) })),
}))
vi.mock('@/lib/auth/get-user-role', () => ({
  getUserRole: vi.fn((u: { role?: string }) => u.role ?? 'manager'),
}))

describe('sources actions (admin gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createSource rejects non-admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', role: 'manager' } } })
    const { createSource } = await import('./actions')
    const res = await createSource('TikTok', '')
    expect(res.success).toBe(false)
  })

  it('createSource inserts trimmed name with synonyms for admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', role: 'admin' } } })
    adminTables.acquisition_sources = makeTable({})
    const { createSource } = await import('./actions')
    const res = await createSource('  TikTok ', 'тикток, tt')
    expect(adminTables.acquisition_sources.insert).toHaveBeenCalledWith({
      name: 'TikTok',
      synonyms: ['тикток', 'tt'],
    })
    expect(res.success).toBe(true)
  })

  it('assignSource updates client source for admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', role: 'admin' } } })
    const clients = makeTable({})
    adminTables.clients = clients
    const { assignSource } = await import('./actions')
    const res = await assignSource('c1', 's1')
    expect(clients.update).toHaveBeenCalledWith({ acquisition_source_id: 's1' })
    expect(res.success).toBe(true)
  })

  it('ignoreAnswer clears raw answer for admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', role: 'admin' } } })
    const clients = makeTable({})
    adminTables.clients = clients
    const { ignoreAnswer } = await import('./actions')
    const res = await ignoreAnswer('c1')
    expect(clients.update).toHaveBeenCalledWith({ acquisition_answer_raw: null })
    expect(res.success).toBe(true)
  })
})
