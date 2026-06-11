import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { sendWhatsAppMessage } from '@/app/(protected)/broadcasts/actions'

const originalEnv = process.env

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv, WAZZUP_API_KEY: 'test-key' }
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => [{ transport: 'whatsapp', state: 'active', channelId: 'ch1' }] })
    .mockResolvedValueOnce({ ok: true })
})

describe('sendWhatsAppMessage', () => {
  it('отправляет chatId как цифры без «+»', async () => {
    const res = await sendWhatsAppMessage('+77057618170', 'Привет')
    expect(res.success).toBe(true)

    const msgCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v3/message'))
    expect(msgCall).toBeDefined()
    const body = JSON.parse((msgCall![1] as { body: string }).body)
    expect(body.chatId).toBe('77057618170')
  })

  it('отклоняет некорректный номер', async () => {
    const res = await sendWhatsAppMessage('123', 'Привет')
    expect(res.success).toBe(false)
  })
})
