import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as { key: string; value: unknown }[], user: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: async () => ({ data: state.rows }),
    }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } }),
}))

import { getSettings, updateTelephonySettings } from '@/app/(protected)/settings/actions'

beforeEach(() => {
  state.rows = []
  state.user = null
})

describe('getSettings — VPBX fields', () => {
  it('defaults profileId and webhookSecret to empty strings', async () => {
    const s = await getSettings()
    expect(s.vpbxProfileId).toBe('')
    expect(s.vpbxWebhookSecret).toBe('')
  })

  it('reads stored VPBX profileId and webhook secret', async () => {
    state.rows = [
      { key: 'vpbx_profile_id', value: '38' },
      { key: 'vpbx_webhook_secret', value: 'abc-secret' },
    ]
    const s = await getSettings()
    expect(s.vpbxProfileId).toBe('38')
    expect(s.vpbxWebhookSecret).toBe('abc-secret')
  })
})

describe('updateTelephonySettings — auth', () => {
  it('denies non-admins', async () => {
    state.user = { id: 'u1', user_metadata: { role: 'manager' } }
    const res = await updateTelephonySettings({
      vpbxToken: 't',
      vpbxUrl: 'https://cloudpbx.beeline.kz/VPBX',
      vpbxProfileId: '38',
      vpbxWebhookSecret: '',
      managers: [],
    })
    expect(res.success).toBe(false)
  })
})
