import { describe, it, expect, vi, beforeEach } from 'vitest'

// user-клиент мокается целиком: теги работают через RLS user-клиента (не admin).
const mockGetUser = vi.fn()

type Row = Record<string, unknown>
// Чейнящийся стаб таблицы: from(table) → builder с select/insert/delete/eq/maybeSingle/single/order.
function makeTable(rows: { maybeSingle?: Row | null; single?: Row | null; list?: Row[]; error?: { code?: string; message: string } | null }) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {}
  const chain = (ret?: unknown) => vi.fn(() => ret ?? b)
  b.select = chain()
  b.insert = chain()
  b.delete = chain()
  b.eq = chain()
  b.order = vi.fn(() => Promise.resolve({ data: rows.list ?? [], error: rows.error ?? null }))
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: rows.maybeSingle ?? null, error: rows.error ?? null }))
  b.single = vi.fn(() => Promise.resolve({ data: rows.single ?? null, error: rows.error ?? null }))
  return b
}

const tables: Record<string, ReturnType<typeof makeTable>> = {}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => tables[table]),
    })
  ),
}))

describe('tag-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('addTagToClient rejects unauthenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { addTagToClient } = await import('./tag-actions')
    const res = await addTagToClient('c1', { name: 'VIP' })
    expect(res).toEqual({ success: false, error: 'Не авторизован' })
  })

  it('addTagToClient creates a new tag by name and links it', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    tables.tags = makeTable({ maybeSingle: null, single: { id: 't-new' } })
    tables.client_tags = makeTable({})
    // insert связи завершается без ошибки
    tables.client_tags.insert = vi.fn(() => Promise.resolve({ error: null }))

    const { addTagToClient } = await import('./tag-actions')
    const res = await addTagToClient('c1', { name: '  VIP  ' })

    expect(tables.tags.insert).toHaveBeenCalledWith({ name: 'VIP', created_by: 'u1' })
    expect(tables.client_tags.insert).toHaveBeenCalledWith({ client_id: 'c1', tag_id: 't-new', created_by: 'u1' })
    expect(res).toEqual({ success: true, tagId: 't-new' })
  })

  it('addTagToClient reuses existing tag with the same name', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    tables.tags = makeTable({ maybeSingle: { id: 't-old' } })
    tables.client_tags = makeTable({})
    tables.client_tags.insert = vi.fn(() => Promise.resolve({ error: null }))

    const { addTagToClient } = await import('./tag-actions')
    const res = await addTagToClient('c1', { name: 'VIP' })

    expect(tables.tags.insert).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true, tagId: 't-old' })
  })

  it('addTagToClient treats duplicate link (23505) as success', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    tables.tags = makeTable({ maybeSingle: { id: 't1' } })
    tables.client_tags = makeTable({})
    tables.client_tags.insert = vi.fn(() => Promise.resolve({ error: { code: '23505', message: 'dup' } }))

    const { addTagToClient } = await import('./tag-actions')
    const res = await addTagToClient('c1', { tagId: 't1' })
    expect(res).toEqual({ success: true, tagId: 't1' })
  })

  it('addTagToClient validates tag name length', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { addTagToClient } = await import('./tag-actions')
    const res = await addTagToClient('c1', { name: 'x'.repeat(41) })
    expect(res.success).toBe(false)
  })
})
