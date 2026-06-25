import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
// Лог — best-effort, в тестах не трогаем admin-клиент.
vi.mock('@/lib/wazzup/log', () => ({ logWazzupCall: vi.fn(async () => {}) }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { sendWhatsAppViaWazzup } from '@/lib/wazzup/send'

const PHONE = '+77077571797'
const DIGITS = '77077571797'

type Channel = { channelId: string; transport: string; state: string }
const channelsResponse = (channels: Channel[]) => ({ ok: true, json: async () => channels })

const ORIGINAL_ENV = process.env

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, WAZZUP_API_KEY: '', WAZZUP_API_KEY_2: '' }
})
afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('sendWhatsAppViaWazzup', () => {
  it('ошибка, если ключей нет', async () => {
    const res = await sendWhatsAppViaWazzup({ phone: PHONE, text: 'hi', managerId: 'm1' })
    expect(res.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отклоняет некорректный номер до обращения к сети', async () => {
    process.env.WAZZUP_API_KEY = 'k1'
    const res = await sendWhatsAppViaWazzup({ phone: '123', text: 'hi', managerId: 'm1' })
    expect(res.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ошибка, если все каналы заблокированы (нет active) — без отправки', async () => {
    process.env.WAZZUP_API_KEY = 'k1'
    fetchMock.mockResolvedValueOnce(
      channelsResponse([
        { channelId: 'blocked1', transport: 'whatsapp', state: 'blocked' },
        { channelId: 'qr1', transport: 'whatsapp', state: 'qridle' },
      ]),
    )
    const res = await sendWhatsAppViaWazzup({ phone: PHONE, text: 'hi', managerId: 'm1' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toMatch(/активн/i)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/v3/message'))).toBe(false)
  })

  it('шлёт через активный канал ВТОРОГО аккаунта его ключом, когда первый весь заблокирован', async () => {
    process.env.WAZZUP_API_KEY = 'primary'
    process.env.WAZZUP_API_KEY_2 = 'secondary'
    fetchMock
      .mockResolvedValueOnce(channelsResponse([{ channelId: 'blk', transport: 'whatsapp', state: 'blocked' }]))
      .mockResolvedValueOnce(channelsResponse([{ channelId: 'fa03', transport: 'whatsapp', state: 'active' }]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: 'msg1' }) })

    const res = await sendWhatsAppViaWazzup({ phone: PHONE, text: 'hi', managerId: 'm1' })
    expect(res.success).toBe(true)

    const msgCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v3/message'))
    expect(msgCall).toBeDefined()
    const init = msgCall![1] as { body: string; headers: Record<string, string> }
    const body = JSON.parse(init.body)
    expect(body.channelId).toBe('fa03')
    expect(body.chatId).toBe(DIGITS)
    expect(init.headers.Authorization).toBe('Bearer secondary')
  })

  it('возвращает ошибку при 404 от Wazzup', async () => {
    process.env.WAZZUP_API_KEY = 'k1'
    fetchMock
      .mockResolvedValueOnce(channelsResponse([{ channelId: 'ch1', transport: 'whatsapp', state: 'active' }]))
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })

    const res = await sendWhatsAppViaWazzup({ phone: PHONE, text: 'hi', managerId: 'm1' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toMatch(/404/)
  })
})
