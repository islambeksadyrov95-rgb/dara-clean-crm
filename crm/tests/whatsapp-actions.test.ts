import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SEGMENT_RULES } from '@/lib/segments'

// generateWhatsAppMessage:
//  1) createClient() → auth.getUser() (проверка сессии)
//  2) createAdminClient().from('clients')... (читает ЛЮБОГО клиента, не scoped-view)
//  3) getSegmentRules() + computeSegment (сегмент считается на сервере)
//  4) fetch к Groq

const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockGetUser = vi.fn()

// Серверный клиент — только auth (запрос клиента идёт через admin).
const mockServer = { auth: { getUser: mockGetUser } }
// Admin-клиент — таблица clients.
const mockAdmin = { from: vi.fn(() => ({ select: mockSelect })) }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockServer)),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdmin),
}))
vi.mock('@/app/(protected)/settings/actions', () => ({
  getSegmentRules: vi.fn(() => Promise.resolve(DEFAULT_SEGMENT_RULES)),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const originalEnv = process.env

describe('generateWhatsAppMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv }
    mockGetUser.mockResolvedValue({ data: { user: { id: 'manager-1' } } })
    mockAdmin.from.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ single: mockSingle })
  })

  it('возвращает fallback если нет GROQ_API_KEY', async () => {
    delete process.env.GROQ_API_KEY

    // segment_override фиксирует сегмент (computeSegment не вызывается) → скидка 5% (Повторный).
    mockSingle.mockResolvedValue({
      data: {
        name: 'Айгуль',
        phone: '+77001234567',
        total_orders: 3,
        total_spent: 50000,
        last_order_date: '2026-05-01',
        segment_override: 'Повторный',
      },
      error: null,
    })

    const { generateWhatsAppMessage } = await import(
      '@/app/(protected)/queue/whatsapp/actions'
    )
    const result = await generateWhatsAppMessage('test-id')

    expect(result.isAI).toBe(false)
    expect(result.clientName).toBe('Айгуль')
    expect(result.phone).toBe('77001234567')
    expect(result.message).toContain('Айгуль')
    expect(result.message).toContain('Скидка 5%')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('вызывает Groq API и возвращает AI сообщение', async () => {
    process.env.GROQ_API_KEY = 'test-key'

    mockSingle.mockResolvedValue({
      data: {
        name: 'Бекзат',
        phone: '77009876543',
        total_orders: 1,
        total_spent: 12000,
        last_order_date: '2026-03-01',
        segment_override: 'В риске',
      },
      error: null,
    })

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'Привет, Бекзат! Скидка ждёт.' } }],
        }),
    })

    const { generateWhatsAppMessage } = await import(
      '@/app/(protected)/queue/whatsapp/actions'
    )
    const result = await generateWhatsAppMessage('test-id')

    expect(result.isAI).toBe(true)
    expect(result.message).toBe('Привет, Бекзат! Скидка ждёт.')
    expect(result.clientName).toBe('Бекзат')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('возвращает fallback если Groq вернул ошибку', async () => {
    process.env.GROQ_API_KEY = 'test-key'

    mockSingle.mockResolvedValue({
      data: {
        name: 'Марат',
        phone: '77005551122',
        total_orders: 0,
        total_spent: 0,
        last_order_date: null,
        segment_override: 'Новый',
      },
      error: null,
    })

    mockFetch.mockResolvedValue({ ok: false, status: 500 })

    const { generateWhatsAppMessage } = await import(
      '@/app/(protected)/queue/whatsapp/actions'
    )
    const result = await generateWhatsAppMessage('test-id')

    expect(result.isAI).toBe(false)
    expect(result.message).toContain('Марат')
  })

  it('бросает ошибку если клиент не найден', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const { generateWhatsAppMessage } = await import(
      '@/app/(protected)/queue/whatsapp/actions'
    )

    await expect(generateWhatsAppMessage('bad-id')).rejects.toThrow(
      'Клиент не найден'
    )
  })

  it('бросает ошибку если нет сессии', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const { generateWhatsAppMessage } = await import(
      '@/app/(protected)/queue/whatsapp/actions'
    )

    await expect(generateWhatsAppMessage('test-id')).rejects.toThrow(
      'Не авторизован'
    )
  })
})
