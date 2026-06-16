'use server'

import { createClient } from '@/lib/supabase/server'

const GROQ_KEY = (process.env.GROQ_API_KEY ?? '').trim()
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

interface WhatsAppMessageResult {
  message: string
  clientName: string
  phone: string
  isAI: boolean
}

const SYSTEM_PROMPT = `Ты лучший менеджер по продажам химчистки ковров Dara Clean (Алматы).
Пишешь WhatsApp-сообщения которые конвертируют. Стиль:
- Максимум 2-3 коротких предложения
- Лёгкий, дружелюбный тон, без пафоса
- Конкретное предложение (скидка, акция, сезон)
- Один чёткий call-to-action в конце
- Используй имя клиента
- Никаких "Мы скучаем", "Рады сообщить" и прочей воды
- Каждое сообщение УНИКАЛЬНОЕ — меняй формулировки, угол подхода, аргументы
- Пиши так, как реальный менеджер в WhatsApp — коротко и по делу

Примеры хороших сообщений:
- "Жанар, привет! Чистка ковров со скидкой 10% до конца недели. Забронировать на удобный день?"
- "Асель, весна — самое время освежить ковры после зимы. Для вас скидка 5%. Записать?"
- "Динара, давно не чистили шторы? Сейчас комплекс ковры+шторы со скидкой 15%. Интересно?"`

export async function generateWhatsAppMessage(
  clientId: string
): Promise<WhatsAppMessageResult> {
  const supabase = await createClient()

  const { data: client, error } = await supabase
    .from('client_segments')
    .select('name, phone, rfm_segment, days_since_last_order, total_orders, total_spent')
    .eq('id', clientId)
    .single()

  if (error || !client) throw new Error('Клиент не найден')

  const name = client.name || 'Клиент'
  const phone = (client.phone || '').replace(/[^0-9]/g, '')
  const days = client.days_since_last_order ?? 0
  const segment = client.rfm_segment || 'Новый'
  const orders = client.total_orders ?? 0
  const spent = client.total_spent ?? 0

  // Скидка по сегменту
  const discountMap: Record<string, number> = { 'Новый': 5, 'Повторный': 5, 'Постоянный': 10, 'В риске': 10, 'Потерянный': 15 }
  const discount = discountMap[segment] ?? 5

  if (!GROQ_KEY) {
    return {
      message: `${name}, привет! Это Dara Clean. Скидка ${discount}% на чистку — действует 7 дней. Записать на удобный день?`,
      clientName: name,
      phone,
      isAI: false,
    }
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      // Таймаут обязателен: без него зависший Groq оставит UI в «Генерация
      // сообщения...» навсегда. По таймауту fetch бросит → catch отдаст fallback-шаблон.
      signal: AbortSignal.timeout(12_000),
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Напиши WhatsApp сообщение.
Клиент: ${name}
Сегмент: ${segment}
Заказов ранее: ${orders}
Потрачено: ${spent} тг
Последний заказ: ${days} дней назад
Скидка для клиента: ${discount}%
Услуги: ковры, шторы, мебель, клининг

Сгенерируй ТОЛЬКО текст сообщения, без кавычек и пояснений.`,
          },
        ],
        temperature: 0.9, // высокая температура для разнообразия
        max_tokens: 150,
      }),
    })

    if (!res.ok) {
      return { message: `${name}, привет! Dara Clean. Скидка ${discount}% на чистку — 7 дней. Записать?`, clientName: name, phone, isAI: false }
    }

    const data = await res.json()
    const aiMessage = data.choices?.[0]?.message?.content?.trim()

    if (!aiMessage) {
      return { message: `${name}, привет! Dara Clean. Скидка ${discount}% — 7 дней. Записать?`, clientName: name, phone, isAI: false }
    }

    return { message: aiMessage, clientName: name, phone, isAI: true }
  } catch {
    return { message: `${name}, привет! Dara Clean. Скидка ${discount}% на чистку. Записать на удобный день?`, clientName: name, phone, isAI: false }
  }
}
