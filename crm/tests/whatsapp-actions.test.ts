import { describe, it, expect, vi, beforeEach } from 'vitest'

// Мок Supabase
const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))

const mockSupabase = {
  from: vi.fn(() => ({ select: mockSelect })),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// Мок fetch для OpenRouter
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const originalEnv = process.env

describe('generateWhatsAppMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv }
    mockSupabase.from.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ single: mockSingle })
  })

  it('возвращает fallback если нет GROQ_API_KEY', async () => {
    delete process.env.GROQ_API_KEY

    mockSingle.mockResolvedValue({
      data: {
        name: 'Айгуль',
        phone: '+77001234567',
        rfm_segment: 'Повторный',
        days_since_last_order: 45,
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
        rfm_segment: 'В риске',
        days_since_last_order: 90,
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
        rfm_segment: 'Новый',
        days_since_last_order: 10,
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
})
