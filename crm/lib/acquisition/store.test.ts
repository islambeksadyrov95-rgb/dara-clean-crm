import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storeAcquisitionFromCall } from '@/lib/acquisition/store'

const mockClassify = vi.fn()
vi.mock('@/lib/acquisition/classify', () => ({
  classifyAcquisitionAnswer: (...a: unknown[]) => mockClassify(...a),
}))

type Row = Record<string, unknown>

function makeAdmin(current: Row | null, sources: Row[]) {
  const updateEq = vi.fn(() => Promise.resolve({ error: null }))
  const update = vi.fn(() => ({ eq: updateEq }))
  const clients = {
    select: vi.fn(() => clients),
    eq: vi.fn(() => clients),
    maybeSingle: vi.fn(() => Promise.resolve({ data: current, error: null })),
    update,
  }
  const acquisitionSources = {
    select: vi.fn(() => acquisitionSources),
    eq: vi.fn(() => Promise.resolve({ data: sources, error: null })),
  }
  const from = vi.fn((t: string) => (t === 'clients' ? clients : acquisitionSources))
  return { admin: { from }, update }
}

describe('storeAcquisitionFromCall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips when the client already has a source (первое касание — истина)', async () => {
    const { admin, update } = makeAdmin({ acquisition_source_id: 's1', acquisition_answer_raw: null }, [])
    await storeAcquisitionFromCall(admin as never, 'c1', 'из инсты')
    expect(update).not.toHaveBeenCalled()
    expect(mockClassify).not.toHaveBeenCalled()
  })

  it('skips when a raw answer is already pending review', async () => {
    const { admin, update } = makeAdmin({ acquisition_source_id: null, acquisition_answer_raw: 'ждёт' }, [])
    await storeAcquisitionFromCall(admin as never, 'c1', 'из инсты')
    expect(update).not.toHaveBeenCalled()
  })

  it('stores raw + source when classification matched', async () => {
    const { admin, update } = makeAdmin(
      { acquisition_source_id: null, acquisition_answer_raw: null },
      [{ id: 's1', name: 'Instagram', synonyms: [] }],
    )
    mockClassify.mockResolvedValue({ sourceId: 's1' })
    await storeAcquisitionFromCall(admin as never, 'c1', 'в инсте видела')
    expect(update).toHaveBeenCalledWith({ acquisition_answer_raw: 'в инсте видела', acquisition_source_id: 's1' })
  })

  it('stores only raw when uncertain — клиент попадает в очередь разбора', async () => {
    const { admin, update } = makeAdmin(
      { acquisition_source_id: null, acquisition_answer_raw: null },
      [{ id: 's1', name: 'Instagram', synonyms: [] }],
    )
    mockClassify.mockResolvedValue({ sourceId: null })
    await storeAcquisitionFromCall(admin as never, 'c1', 'не помню')
    expect(update).toHaveBeenCalledWith({ acquisition_answer_raw: 'не помню' })
  })
})
