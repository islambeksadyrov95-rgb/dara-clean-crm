import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = (process.env.GROQ_API_KEY ?? '').trim()
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

type ScoreRequest = {
  transcript: string
  segment: string
  totalOrders: number
  daysSinceLastOrder: number | null
  clientName: string
}

type ScoreResponse = {
  score: number
  summary: string
  strengths: string[]
  improvements: string[]
}

import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ScoreRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }
  if (!body || typeof body.transcript !== 'string' || !body.transcript.trim()) {
    return NextResponse.json({ error: 'Пустой транскрипт' }, { status: 400 })
  }

  const prompt = `Ты эксперт по продажам в сфере клининга (химчистка ковров, штор, мебели).
Оцени эффективность звонка менеджера.

ВАЖНО: Разговор может вестись на русском, казахском или смешанном (русско-казахском) языке. Ты должен полностью понимать оба языка.
Результаты анализа (summary, strengths, improvements) напиши на русском языке (если преобладал русский или смешанный) или на казахском языке (если весь разговор велся на казахском).

Контекст клиента:
- Имя: ${body.clientName}
- Сегмент: ${body.segment}
- Заказов ранее: ${body.totalOrders}
- Дней без заказа: ${body.daysSinceLastOrder ?? 'неизвестно'}

Транскрипт звонка:
${body.transcript}

Оцени по шкале 1-10:
- Приветствие и представление
- Выявление потребности
- Презентация услуги
- Работа с возражениями
- Закрытие сделки

Ответь СТРОГО в JSON (без markdown):
{"score": <число 1-10>, "summary": "<итог 2-3 предложения>", "strengths": ["что хорошо"], "improvements": ["что улучшить"]}`

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    })

    if (!res.ok) {
      console.error('[api/score] Groq error', res.status, await res.text())
      return NextResponse.json({ error: 'Не удалось оценить звонок' }, { status: 500 })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''

    // Парсим JSON из ответа
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[api/score] Invalid LLM response', content)
      return NextResponse.json({ error: 'Не удалось оценить звонок' }, { status: 500 })
    }

    const result: ScoreResponse = JSON.parse(jsonMatch[0])
    result.score = Math.max(1, Math.min(10, Math.round(result.score)))

    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/score] exception', e)
    return NextResponse.json({ error: 'Не удалось оценить звонок' }, { status: 500 })
  }
}
