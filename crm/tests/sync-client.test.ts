import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}))

type AttachResult =
  | { success: false; error: string }
  | { success: true; matched: false }
  | { success: true; matched: true; logId: string }
const actions = vi.hoisted(() => ({
  attachLocalRecording: vi.fn(async (): Promise<AttachResult> => ({ success: true, matched: true, logId: 'log1' })),
  transcribeLocalRecording: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock('@/lib/recordings/actions', () => actions)

const memory: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory[k] ?? null,
  setItem: (k: string, v: string) => {
    memory[k] = v
  },
})

import { scanFolder, type DirHandle, type DirEntry } from '@/lib/recordings/sync-client'

function makeHandle(names: string[]): DirHandle {
  return {
    name: 'rec',
    values: async function* (): AsyncIterableIterator<DirEntry> {
      for (const n of names) {
        yield { kind: 'file', name: n, getFile: async () => new File(['x'], n, { type: 'audio/mpeg' }) }
      }
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(memory)) delete memory[k]
})

describe('scanFolder', () => {
  it('uploads only new .mp3 files and triggers transcription for each', async () => {
    const added = await scanFolder(makeHandle(['a.mp3', 'notes.txt', 'b.mp3']))
    expect(added).toBe(2)
    expect(actions.attachLocalRecording).toHaveBeenCalledTimes(2)
    expect(actions.transcribeLocalRecording).toHaveBeenCalledTimes(2)
  })

  it('skips files already uploaded (dedup via localStorage)', async () => {
    memory['dara-uploaded-recordings'] = JSON.stringify(['a.mp3'])
    const added = await scanFolder(makeHandle(['a.mp3', 'c.mp3']))
    expect(added).toBe(1)
    expect(actions.attachLocalRecording).toHaveBeenCalledTimes(1)
  })

  it('does not transcribe when the recording matched no call', async () => {
    actions.attachLocalRecording.mockResolvedValueOnce({ success: true as const, matched: false as const })
    const added = await scanFolder(makeHandle(['d.mp3']))
    expect(added).toBe(1)
    expect(actions.transcribeLocalRecording).not.toHaveBeenCalled()
  })
})
