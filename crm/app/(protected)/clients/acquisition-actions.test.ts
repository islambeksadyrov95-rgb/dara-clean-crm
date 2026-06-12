import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockClassify = vi.fn()

type Row = Record<string, unknown>
const adminTables: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {}

function makeAdminTable(rows: { maybeSingle?: Row | null; list?: Row[] }) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {}
  const chain = () => vi.fn(() => b)
  b.select = chain()
  b.update = chain()
  b.eq = chain()
  b.is = chain()
  b.not = chain()
  b.order = vi.fn(() => Promise.resolve({ data: rows.list ?? [], error: null }))
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: rows.maybeSingle ?? null, error: null }))
  // update().eq() как терминальный await: thenable
  b.then = undefined as unknown as ReturnType<typeof vi.fn>
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn((t: string) => adminTables[t]) })),
}))
vi.mock('@/lib/acquisition/classify', () => ({
  classifyAcquisitionAnswer: (...args: unknown[]) => mockClassify(...args),
}))

describe('saveAcquisitionAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { saveAcquisitionAnswer } = await import('./acquisition-actions')
    const res = await saveAcquisitionAnswer('c1', 'инста')
    expect(res.success).toBe(false)
  })

  it('does not overwrite an already assigned source (первое касание — истина)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    adminTables.clients = makeAdminTable({ maybeSingle: { acquisition_source_id: 's-existing' } })
    const { saveAcquisitionAnswer } = await import('./acquisition-actions')
    const res = await saveAcquisitionAnswer('c1', 'инста')
    expect(res).toEqual({ success: true, matched: true, alreadySet: true })
    expect(mockClassify).not.toHaveBeenCalled()
  })

  it('classifies and stores matched source', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const clientsTable = makeAdminTable({ maybeSingle: { acquisition_source_id: null } })
    const updateEq = vi.fn(() => Promise.resolve({ error: null }))
    clientsTable.update = vi.fn(() => ({ eq: updateEq }))
    adminTables.clients = clientsTable
    adminTables.acquisition_sources = makeAdminTable({
      list: [{ id: 's1', name: 'Instagram', synonyms: ['инста'] }],
    })
    mockClassify.mockResolvedValue({ sourceId: 's1' })

    const { saveAcquisitionAnswer } = await import('./acquisition-actions')
    const res = await saveAcquisitionAnswer('c1', 'мне в инсте показали')

    expect(clientsTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ acquisition_source_id: 's1', acquisition_answer_raw: 'мне в инсте показали' })
    )
    expect(res).toEqual({ success: true, matched: true, alreadySet: false })
  })

  it('stores raw answer without source when classification is uncertain', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const clientsTable = makeAdminTable({ maybeSingle: { acquisition_source_id: null } })
    const updateEq = vi.fn(() => Promise.resolve({ error: null }))
    clientsTable.update = vi.fn(() => ({ eq: updateEq }))
    adminTables.clients = clientsTable
    adminTables.acquisition_sources = makeAdminTable({ list: [{ id: 's1', name: 'Instagram', synonyms: [] }] })
    mockClassify.mockResolvedValue({ sourceId: null })

    const { saveAcquisitionAnswer } = await import('./acquisition-actions')
    const res = await saveAcquisitionAnswer('c1', 'не помню откуда')

    expect(clientsTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ acquisition_answer_raw: 'не помню откуда' })
    )
    const updatePayload = (clientsTable.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload.acquisition_source_id).toBeUndefined()
    expect(res).toEqual({ success: true, matched: false, alreadySet: false })
  })
})
