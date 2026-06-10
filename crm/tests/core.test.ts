import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { assignSpeakers, scoreCall, type WhisperSegment } from '@/lib/transcription/core'

describe('assignSpeakers', () => {
  it('starts with the manager and merges adjacent same-speaker segments', () => {
    const segments: WhisperSegment[] = [
      { start: 0, end: 1, text: 'Здравствуйте' },
      { start: 1.1, end: 2, text: 'это Dara Clean' },
    ]
    const chat = assignSpeakers(segments)
    expect(chat).toHaveLength(1)
    expect(chat[0].speaker).toBe('manager')
    expect(chat[0].text).toBe('Здравствуйте это Dara Clean')
  })

  it('switches speaker after a long pause', () => {
    const segments: WhisperSegment[] = [
      { start: 0, end: 1, text: 'Здравствуйте' },
      { start: 3, end: 4, text: 'Да, слушаю' },
    ]
    const chat = assignSpeakers(segments)
    expect(chat).toHaveLength(2)
    expect(chat[0].speaker).toBe('manager')
    expect(chat[1].speaker).toBe('client')
  })

  it('ignores empty segments', () => {
    expect(assignSpeakers([])).toEqual([])
  })
})

describe('scoreCall', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('GROQ_API_KEY', 'test-key')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('parses JSON from the LLM response and clamps the score to 1..10', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"score": 15, "summary": "ok", "strengths": ["a"], "improvements": ["b"]}' } }],
        }),
        { status: 200 }
      )
    )

    const result = await scoreCall({
      transcript: 'manager: привет',
      segment: 'Повторный',
      totalOrders: 3,
      daysSinceLastOrder: 40,
      clientName: 'Иван',
    })

    expect(result.score).toBe(10)
    expect(result.summary).toBe('ok')
    expect(result.strengths).toEqual(['a'])
  })

  it('throws when the LLM returns no JSON object', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'no json here' } }] }), { status: 200 })
    )
    await expect(
      scoreCall({ transcript: 'x', segment: 'Новый', totalOrders: 0, daysSinceLastOrder: null, clientName: 'A' })
    ).rejects.toThrow()
  })
})
