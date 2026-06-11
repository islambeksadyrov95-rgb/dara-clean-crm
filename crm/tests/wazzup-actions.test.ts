import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ user: { id: 'u1', user_metadata: { name: 'Самал' } } as Record<string, unknown> | null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { getWazzupChatUrl } from '@/lib/wazzup/actions'

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'u1', user_metadata: { name: 'Самал' } }
  // 1-й fetch — sync users; 2-й fetch — /v3/iframe.
  fetchMock
    .mockResolvedValueOnce({ ok: true, text: async () => '' })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://chat.example/iframe' }) })
})

describe('getWazzupChatUrl', () => {
  it('передаёт chatId как цифры без «+» (формат Wazzup)', async () => {
    const res = await getWazzupChatUrl('+77057618170')
    expect(res.success).toBe(true)

    const iframeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v3/iframe'))
    expect(iframeCall).toBeDefined()
    const body = JSON.parse((iframeCall![1] as { body: string }).body)
    expect(body.filter[0].chatId).toBe('77057618170')
  })

  it('отклоняет некорректный номер до запроса в Wazzup', async () => {
    const res = await getWazzupChatUrl('123')
    expect(res.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('требует авторизацию', async () => {
    state.user = null
    const res = await getWazzupChatUrl('+77057618170')
    expect(res.success).toBe(false)
  })
})
