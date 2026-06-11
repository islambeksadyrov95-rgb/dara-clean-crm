import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type LogRow = { id: string } | null
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
  signError: null as null | { message: string },
  updateSpy: vi.fn(),
  signedPathSpy: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          state.signedPathSpy(path)
          return state.signError
            ? { data: null, error: state.signError }
            : { data: { signedUrl: 'https://signed/u' }, error: null }
        },
      }),
    },
    from: (table: string) => {
      if (table === 'clients') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.clientRow }) }) }) }
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

import { attachLocalRecording } from '@/lib/recordings/actions'

beforeEach(() => {
  vi.clearAllMocks()
  state.user = null
  state.clientRow = null
  state.logRow = null
  state.signError = null
})

describe('attachLocalRecording', () => {
  it('fails when unauthenticated', async () => {
    const res = await attachLocalRecording({ fileName: 'x.mp3', lastModifiedMs: 0, storagePath: 'local/x.mp3' })
    expect(res.success).toBe(false)
  })

  it('fails when signed URL cannot be created', async () => {
    state.user = { id: 'u1' }
    state.signError = { message: 'no object' }
    const res = await attachLocalRecording({ fileName: 'x.mp3', lastModifiedMs: 0, storagePath: 'local/x.mp3' })
    expect(res.success).toBe(false)
  })

  it('matches by phone in filename and writes the signed URL to audio_url', async () => {
    state.user = { id: 'u1' }
    state.clientRow = { id: 'cl1' }
    state.logRow = { id: 'log1' }
    const res = await attachLocalRecording({
      fileName: '20260611_153045_77057618170.mp3',
      lastModifiedMs: Date.now(),
      storagePath: 'local/20260611_153045_77057618170.mp3',
    })
    expect(res.success).toBe(true)
    if (res.success) expect(res.matched).toBe(true)
    expect(state.updateSpy).toHaveBeenCalledWith({ audio_url: 'https://signed/u' })
  })

  it('returns matched:false when no call_log is found in the window', async () => {
    state.user = { id: 'u1' }
    state.logRow = null
    const res = await attachLocalRecording({ fileName: 'rec.mp3', lastModifiedMs: Date.now(), storagePath: 'local/rec.mp3' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.matched).toBe(false)
    expect(state.updateSpy).not.toHaveBeenCalled()
  })
})
