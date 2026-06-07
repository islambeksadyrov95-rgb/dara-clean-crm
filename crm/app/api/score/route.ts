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

  const body: ScoreRequest = await req.json()

  const prompt = `Ты эксперт по продажам в сфере клининга (химчистка ковров, штор, мебели).
Оцени эффективность звонка менеджера.

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
      const err = await res.text()
      return NextResponse.json({ error: `Groq error: ${err}` }, { status: 500 })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''

    // Парсим JSON из ответа
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Invalid LLM response', raw: content }, { status: 500 })
    }

    const result: ScoreResponse = JSON.parse(jsonMatch[0])
    result.score = Math.max(1, Math.min(10, Math.round(result.score)))

    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
