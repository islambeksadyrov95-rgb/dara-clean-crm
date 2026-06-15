import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/transcription/core', () => ({
  transcribeAudio: vi.fn(async () => ({
    raw: 'привет',
    corrected: 'привет',
    segments: [{ speaker: 'manager', text: 'привет', start: 0, end: 5 }],
  })),
  scoreCall: vi.fn(async () => ({ score: 7, summary: 'итог', strengths: [], improvements: [] })),
}))

type LogRow = { id: string; audio_url?: string | null; client_id?: string | null; transcript?: string | null } | null
type ClientRow = { id: string } | null
type CallLogChain = {
  gte: () => CallLogChain
  lte: () => CallLogChain
  order: () => CallLogChain
  limit: () => CallLogChain
  eq: () => CallLogChain
  maybeSingle: () => Promise<{ data: LogRow }>
}

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  clientRow: null as ClientRow,
  logRow: null as LogRow,
  segmentRow: null as Record<string, unknown> | null,
  signError: null as null | { message: string },
  updateSpy: vi.fn(),
}))

vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'audio/mpeg' }) }))
)

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () =>
          state.signError ? { data: null, error: state.signError } : { data: { signedUrl: 'https://signed/u' }, error: null },
      }),
    },
    from: (table: string) => {
      if (table === 'clients') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.clientRow }) }) }) }
      }
      if (table === 'client_segments') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.segmentRow }) }) }) }
      }
      const chain: CallLogChain = {
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: state.logRow }),
      }
      return {
        select: () => chain,
        update: (payload: unknown) => ({
          eq: async () => {
            state.updateSpy(payload)
            return { error: null }
          },
        }),
      }
    },
  }),
}))

import { attachLocalRecording, transcribeLocalRecording } from '@/lib/recordings/actions'

beforeEach(() => {
  vi.clearAllMocks()
  state.user = null
  state.clientRow = null
  state.logRow = null
  state.segmentRow = null
  state.signError = null
})

describe('attachLocalRecording', () => {
  it('fails when unauthenticated', async () => {
    const res = await attachLocalRecording({ fileName: 'x.mp3', lastModifiedMs: 0, storagePath: 'local/u1/x.mp3' })
    expect(res.success).toBe(false)
  })

  it('fails when signed URL cannot be created', async () => {
    state.user = { id: 'u1' }
    state.signError = { message: 'no object' }
    const res = await attachLocalRecording({ fileName: 'x.mp3', lastModifiedMs: 0, storagePath: 'local/u1/x.mp3' })
    expect(res.success).toBe(false)
  })

  it('matches by phone and returns logId + writes the signed URL', async () => {
    state.user = { id: 'u1' }
    state.clientRow = { id: 'cl1' }
    state.logRow = { id: 'log1' }
    const res = await attachLocalRecording({
      fileName: '20260611-153045-+77057618170-incoming-0367.mp3',
      lastModifiedMs: Date.now(),
      storagePath: 'local/u1/f.mp3',
    })
    expect(res.success).toBe(true)
    if (res.success && res.matched) expect(res.logId).toBe('log1')
    expect(state.updateSpy).toHaveBeenCalledWith({ audio_url: 'https://signed/u' })
  })

  it('returns matched:false when no call_log is found', async () => {
    state.user = { id: 'u1' }
    state.logRow = null
    const res = await attachLocalRecording({ fileName: 'rec.mp3', lastModifiedMs: Date.now(), storagePath: 'local/u1/rec.mp3' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.matched).toBe(false)
  })
})

describe('transcribeLocalRecording', () => {
  it('fails when unauthenticated', async () => {
    const res = await transcribeLocalRecording('log1')
    expect(res.ok).toBe(false)
  })

  it('skips when the call_log already has a transcript (idempotent)', async () => {
    state.user = { id: 'u1' }
    state.logRow = { id: 'log1', audio_url: 'https://signed/u', client_id: 'cl1', transcript: 'есть' }
    const res = await transcribeLocalRecording('log1')
    expect(res.ok).toBe(true)
    expect(state.updateSpy).not.toHaveBeenCalled()
  })

  it('transcribes, scores and writes transcript/summary/call_score', async () => {
    state.user = { id: 'u1' }
    state.logRow = { id: 'log1', audio_url: 'https://signed/u', client_id: 'cl1', transcript: null }
    state.segmentRow = { id: 'cl1', name: 'Иван', total_orders: 3, last_order_date: null, rfm_segment: 'Новый' }
    const res = await transcribeLocalRecording('log1')
    expect(res.ok).toBe(true)
    expect(state.updateSpy).toHaveBeenCalledWith({
      transcript: 'привет',
      summary: 'итог',
      call_score: 7,
      call_duration: 5,
    })
  })
})
