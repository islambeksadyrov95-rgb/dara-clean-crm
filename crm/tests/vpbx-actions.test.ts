import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const client = vi.hoisted(() => ({
  getVpbxConfig: vi.fn(),
  makeCall2: vi.fn(),
  subscribe: vi.fn(),
  getSubscriptions: vi.fn(),
  deleteSubscriptions: vi.fn(),
  getWebhookUrl: vi.fn(() => 'https://crm.example.com/api/vpbx/webhook?s=secret'),
}))
vi.mock('@/lib/vpbx/client', () => client)

const state = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, insertSpy: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    // crm_settings read for the "can call" permission check (no row => allowed).
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async (payload: unknown) => { state.insertSpy(payload); return { error: null } } }),
  }),
}))

import { makeSipCall, subscribeVpbx } from '@/lib/vpbx/actions'

const manager = { id: 'u1', user_metadata: { sip_extension: '101' }, app_metadata: { role: 'manager' } }
const admin = { id: 'a1', user_metadata: { sip_extension: '100' }, app_metadata: { role: 'admin' } }

beforeEach(() => {
  vi.clearAllMocks()
  client.getVpbxConfig.mockResolvedValue({ url: 'u', token: 't', profileId: '38', webhookSecret: 'secret' })
})

describe('makeSipCall', () => {
  it('fails when the user is not authenticated', async () => {
    state.user = null
    const res = await makeSipCall('+77001234567', 'cl1')
    expect(res.success).toBe(false)
  })

  it('fails when the manager has no SIP extension', async () => {
    state.user = { id: 'u1', app_metadata: { role: 'manager' } }
    const res = await makeSipCall('+77001234567', 'cl1')
    expect(res.success).toBe(false)
  })

  it('places the call with an externalCallId and records the outbound call', async () => {
    state.user = manager
    client.makeCall2.mockResolvedValue({ uuid: 'call-uuid-7', externalCallId: 'crm-x' })

    const res = await makeSipCall('+7 700 123-45-67', 'cl1')

    expect(res.success).toBe(true)
    const callArgs = client.makeCall2.mock.calls[0][1]
    expect(callArgs.abonentNumber).toBe('101')
    expect(callArgs.number).toBe('77001234567')
    expect(callArgs.externalCallId).toMatch(/^crm-/)
    const inserted = state.insertSpy.mock.calls[0][0]
    expect(inserted.direction).toBe('outbound')
    expect(inserted.manager_id).toBe('u1')
    expect(inserted.client_id).toBe('cl1')
    expect(inserted.vpbx_uuid).toBe('call-uuid-7')
  })
})

describe('subscribeVpbx', () => {
  it('is denied for non-admins', async () => {
    state.user = manager
    const res = await subscribeVpbx()
    expect(res.success).toBe(false)
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('subscribes for admins', async () => {
    state.user = admin
    client.subscribe.mockResolvedValue({ subscriptionId: 'sub-1', expiresAt: '2026-06-12T00:00:00Z' })
    const res = await subscribeVpbx()
    expect(res.success).toBe(true)
    expect(client.subscribe).toHaveBeenCalledTimes(1)
  })
})
