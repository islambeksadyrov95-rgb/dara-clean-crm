import { describe, it, expect, vi, beforeEach } from 'vitest'

const afterMock = vi.hoisted(() => vi.fn())
vi.mock('next/server', () => ({ after: afterMock }))

const client = vi.hoisted(() => ({
  getVpbxConfig: vi.fn(),
  getWebhookUrl: vi.fn(() => 'https://crm.example.com/api/vpbx/webhook?s=secret'),
  subscribe: vi.fn(),
  getRecordResponse: vi.fn(),
}))
vi.mock('@/lib/vpbx/client', () => client)

const events = vi.hoisted(() => ({ processVpbxEvent: vi.fn() }))
vi.mock('@/lib/vpbx/events', () => events)

const transcribe = vi.hoisted(() => ({ transcribeVpbxCall: vi.fn() }))
vi.mock('@/lib/vpbx/transcribe', () => transcribe)

const supa = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: supa.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: supa.maybeSingle }) }) }),
  }),
}))

import { POST } from '@/app/api/vpbx/webhook/route'
import { GET as cronGET } from '@/app/api/cron/vpbx/route'
import { GET as recordingGET } from '@/app/api/vpbx/recording/route'

beforeEach(() => {
  vi.clearAllMocks()
  client.getVpbxConfig.mockResolvedValue({ url: 'u', token: 't', profileId: '38', webhookSecret: 'secret' })
  events.processVpbxEvent.mockResolvedValue({ ok: true })
})

function post(query: string, body: unknown): Request {
  return new Request(`https://crm.example.com/api/vpbx/webhook${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('VPBX webhook', () => {
  it('rejects a request with the wrong secret', async () => {
    const res = await POST(post('?s=wrong', { type: 'CallStartEvent', eventID: 'e', uuid: 'u' }))
    expect(res.status).toBe(403)
    expect(events.processVpbxEvent).not.toHaveBeenCalled()
  })

  it('processes an event when the secret matches', async () => {
    const res = await POST(post('?s=secret', { type: 'CallStartEvent', eventID: 'e', uuid: 'u' }))
    expect(res.status).toBe(200)
    expect(events.processVpbxEvent).toHaveBeenCalledTimes(1)
  })

  it('schedules transcription for a recorded finished call', async () => {
    events.processVpbxEvent.mockResolvedValue({
      ok: true,
      event: { type: 'CallFinishEvent', eventID: 'e', uuid: 'call-9', isRecorded: true },
    })
    await POST(post('?s=secret', {}))
    expect(afterMock).toHaveBeenCalledTimes(1)
  })

  it('does not schedule transcription for duplicate events', async () => {
    events.processVpbxEvent.mockResolvedValue({
      ok: true,
      duplicate: true,
      event: { type: 'CallFinishEvent', eventID: 'e', uuid: 'call-9', isRecorded: true },
    })
    await POST(post('?s=secret', {}))
    expect(afterMock).not.toHaveBeenCalled()
  })
})

describe('VPBX cron renew', () => {
  function cronReq(auth?: string): Request {
    return new Request('https://crm.example.com/api/cron/vpbx', {
      headers: auth ? { authorization: auth } : {},
    })
  }

  it('rejects requests without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-123')
    const res = await cronGET(cronReq('Bearer wrong'))
    expect(res.status).toBe(401)
    vi.unstubAllEnvs()
  })

  it('renews the subscription when authorized and configured', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-123')
    client.subscribe.mockResolvedValue({ subscriptionId: 'sub-1', expiresAt: '2026-06-12T00:00:00Z' })
    const res = await cronGET(cronReq('Bearer cron-123'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.subscriptionId).toBe('sub-1')
    expect(client.subscribe).toHaveBeenCalledTimes(1)
    vi.unstubAllEnvs()
  })
})

describe('VPBX recording proxy', () => {
  function recReq(query = '?uuid=call-9'): Request {
    return new Request(`https://crm.example.com/api/vpbx/recording${query}`)
  }

  it('returns 401 for unauthenticated users', async () => {
    supa.getUser.mockResolvedValue({ data: { user: null } })
    const res = await recordingGET(recReq())
    expect(res.status).toBe(401)
  })

  it('returns 400 when uuid is missing', async () => {
    supa.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await recordingGET(recReq(''))
    expect(res.status).toBe(400)
  })

  it('streams the recording for an owned call', async () => {
    supa.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supa.maybeSingle.mockResolvedValue({ data: { id: 'c9' } })
    client.getRecordResponse.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    )
    const res = await recordingGET(recReq())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
  })
})
