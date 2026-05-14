'use server'

import { createClient } from '@/lib/supabase/server'

interface WhatsAppMessageResult {
  message: string
  clientName: string
  phone: string
  isAI: boolean
}

function buildFallbackMessage(name: string, days: number): string {
  return `Здравствуйте, ${name}! Это Dara Clean. Прошло ${days} дней с вашего последнего заказа. Мы подготовили для вас специальное предложение — скидка 5% на следующую чистку. Напишите нам, чтобы оформить заказ!`
}

export async function generateWhatsAppMessage(
  clientId: string
): Promise<WhatsAppMessageResult> {
  const supabase = await createClient()

  const { data: client, error } = await supabase
    .from('client_segments')
    .select('name, phone, rfm_segment, days_since_last_order')
    .eq('id', clientId)
    .single()

  if (error || !client) {
    throw new Error('Клиент не найден')
  }

  const name = client.name || 'Клиент'
  const phone = (client.phone || '').replace(/[^0-9]/g, '')
  const days = client.days_since_last_order ?? 0

  const segment = client.rfm_segment || 'Новый'
  const apiKey = (process.env.OPENROUTER_API_KEY ?? '').trim()

  if (!apiKey) {
    return {
      message: buildFallbackMessage(name, days),
      clientName: name,
      phone,
      isAI: false,
    }
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [
          {
            role: 'system',
            content:
              'Ты менеджер химчистки ковров Dara Clean в Алматы. Напиши короткое персональное WhatsApp сообщение клиенту. Цель — пригласить на повторную чистку. Тон дружелюбный но не навязчивый. Максимум 3 предложения.',
          },
          {
            role: 'user',
            content: `Клиент: ${name}. Последний заказ: ${days} дней назад. Сегмент: ${segment}. Текущее предложение: скидка 5% на следующий заказ.`,
          },
        ],
      }),
    })

    if (!res.ok) {
      return {
        message: buildFallbackMessage(name, days),
        clientName: name,
        phone,
        isAI: false,
      }
    }

    const data = await res.json()
    const aiMessage = data.choices?.[0]?.message?.content?.trim()

    if (!aiMessage) {
      return {
        message: buildFallbackMessage(name, days),
        clientName: name,
        phone,
        isAI: false,
      }
    }

    return {
      message: aiMessage,
      clientName: name,
      phone,
      isAI: true,
    }
  } catch {
    return {
      message: buildFallbackMessage(name, days),
      clientName: name,
      phone,
      isAI: false,
    }
  }
}
