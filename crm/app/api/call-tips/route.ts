import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = (process.env.GROQ_API_KEY ?? '').trim()
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
  }

  const { transcript } = await req.json()
  if (!transcript) {
    return NextResponse.json({ tips: [] })
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'system',
          content: `Ты тренер отдела продаж химчистки ковров (Dara Clean, Алматы).
Менеджер сейчас разговаривает с клиентом по телефону. Ты видишь live-транскрипт.

Дай 1-3 короткие подсказки что сказать ПРЯМО СЕЙЧАС чтобы увеличить шанс продажи.

Правила:
- Максимум 3 подсказки, каждая до 15 слов
- Конкретные фразы которые можно сказать прямо сейчас
- Учитывай контекст: что клиент уже сказал, какие возражения
- На русском (менеджер читает подсказки, а не клиент)
- Если клиент уже согласился — подсказки про допродажи (шторы, мебель)
- Если клиент сомневается — подсказки про скидку, акцию, качество
- Если клиент отказывается — подсказки про перезвон, WhatsApp
- Ответ СТРОГО JSON: {"tips": ["подсказка 1", "подсказка 2"]}`,
        }, {
          role: 'user',
          content: `Транскрипт разговора:\n${transcript}`,
        }],
        temperature: 0.3,
        max_tokens: 200,
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ tips: [] })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ tips: [] })

    const parsed = JSON.parse(jsonMatch[0])
    return NextResponse.json({ tips: parsed.tips ?? [] })
  } catch {
    return NextResponse.json({ tips: [] })
  }
}
