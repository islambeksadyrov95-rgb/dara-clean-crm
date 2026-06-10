import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// --- mock dependencies (hoisted so the mock factories can reference them) ---
const core = vi.hoisted(() => ({ transcribeAudio: vi.fn(), scoreCall: vi.fn() }))
vi.mock('@/lib/transcription/core', () => core)

const client = vi.hoisted(() => ({ getVpbxConfig: vi.fn(), getRecordResponse: vi.fn() }))
vi.mock('@/lib/vpbx/client', () => client)

const state = vi.hoisted(() => ({ callRow: null as Record<string, unknown> | null, updateSpy: vi.fn() }))
const updateSpy = state.updateSpy

function makeAdmin() {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () =>
                  table === 'vpbx_calls'
                    ? { data: state.callRow }
                    : { data: { id: 'cl1', name: 'Иван', total_orders: 2, last_order_date: null } },
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          updateSpy(patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdmin() }))

import { transcribeVpbxCall } from '@/lib/vpbx/transcribe'

beforeEach(() => {
  vi.clearAllMocks()
  client.getVpbxConfig.mockResolvedValue({ url: 'u', token: 't', profileId: '38', webhookSecret: 's' })
})

describe('transcribeVpbxCall', () => {
  it('skips calls without a recording', async () => {
    state.callRow = { id: 'c1', vpbx_uuid: 'u1', is_recorded: false, transcription_status: 'pending', client_id: null }
    const res = await transcribeVpbxCall('c1')
    expect(res.ok).toBe(false)
    expect(core.transcribeAudio).not.toHaveBeenCalled()
  })

  it('transcribes, scores (with client) and marks done', async () => {
    state.callRow = { id: 'c2', vpbx_uuid: 'u2', is_recorded: true, transcription_status: 'pending', client_id: 'cl1' }
    client.getRecordResponse.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    core.transcribeAudio.mockResolvedValue({ raw: 'r', corrected: 'привет', segments: [] })
    core.scoreCall.mockResolvedValue({ score: 8, summary: 'итог', strengths: [], improvements: [] })

    const res = await transcribeVpbxCall('c2')

    expect(res.ok).toBe(true)
    expect(core.transcribeAudio).toHaveBeenCalledTimes(1)
    expect(core.scoreCall).toHaveBeenCalledTimes(1)
    const patch = updateSpy.mock.calls.at(-1)?.[0]
    expect(patch.transcription_status).toBe('done')
    expect(patch.transcript).toBe('привет')
    expect(patch.score).toBe(8)
    expect(patch.summary).toBe('итог')
  })
})
