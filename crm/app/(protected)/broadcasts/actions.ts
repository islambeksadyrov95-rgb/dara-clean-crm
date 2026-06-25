'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { sanitizeSearchTerm } from '@/lib/search'
import { sendWhatsAppViaWazzup } from '@/lib/wazzup/send'
import { revalidatePath } from 'next/cache'

// Тип для логов рассылок
export type BroadcastLogEntry = {
  id: string
  client_id: string
  client_name: string
  client_phone: string
  manager_id: string
  manager_name: string
  scenario: string
  message_text: string
  status: 'sent' | 'failed'
  error_message: string | null
  sent_at: string
}

// Клиенты по списку id (предвыбор из /clients и /queue → «В рассылку»).
// User-клиент: RLS отдаёт только доступных пользователю клиентов (свои + общий пул, админ — всех).
export async function getBroadcastClientsByIds(ids: string[]) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }
    if (ids.length === 0) return { success: true as const, clients: [] }

    const { data, error } = await supabase
      .from('client_segments')
      .select('id, name, phone, total_orders, total_spent, last_order_date, rfm_segment, days_since_last_order')
      .in('id', ids.slice(0, 1000))
      .order('last_order_date', { ascending: true, nullsFirst: true })

    if (error) {
      console.error('[getBroadcastClientsByIds]', error.message)
      return { success: false as const, error: 'Ошибка загрузки выбранных клиентов' }
    }
    return { success: true as const, clients: data || [] }
  } catch (err) {
    console.error('getBroadcastClientsByIds error:', err)
    return { success: false as const, error: 'Ошибка сервера' }
  }
}

// Получение списка клиентов для рассылки
export async function getBroadcastClients(filters: {
  search?: string
  segment?: string
}) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    let query = supabase
      .from('client_segments')
      .select('id, name, phone, total_orders, total_spent, last_order_date, rfm_segment, days_since_last_order')

    const sanitizedSearch = sanitizeSearchTerm(filters.search ?? '')
    if (sanitizedSearch) {
      const term = `%${sanitizedSearch}%`
      query = query.or(`name.ilike.${term},phone.ilike.${term}`)
    }

    if (filters.segment && filters.segment !== 'Все') {
      query = query.eq('rfm_segment', filters.segment)
    }

    // Сначала показываем тех, кто дольше всего не заказывал
    query = query.order('last_order_date', { ascending: true, nullsFirst: true })

    const { data, error } = await query

    if (error) {
      return { success: false as const, error: `Ошибка БД: ${error.message}` }
    }

    return { success: true as const, clients: data || [] }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Ошибка сервера' }
  }
}

// Получение шаблонов предложений
export async function getTemplates() {
  try {
    const supabase = await createSupabaseClient()
    const { data, error } = await supabase
      .from('broadcast_templates')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching templates:', error.message)
      return []
    }

    return data || []
  } catch (err) {
    console.error('getTemplates error:', err)
    return []
  }
}

// Создание нового шаблона предложения
export async function createTemplate(title: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (!title.trim()) {
      return { success: false as const, error: 'Название предложения не может быть пустым' }
    }

    const { data, error } = await supabase
      .from('broadcast_templates')
      .insert({
        title: title.trim(),
        category: 'custom',
        created_by: user.id,
      })
      .select('id')
      .single()

    if (error) {
      return { success: false as const, error: `Ошибка базы данных: ${error.message}` }
    }

    revalidatePath('/broadcasts')
    return { success: true as const, templateId: data.id }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Удаление шаблона предложения
export async function deleteTemplate(id: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const { error } = await supabase
      .from('broadcast_templates')
      .delete()
      .eq('id', id)

    if (error) {
      return { success: false as const, error: `Ошибка при удалении шаблона: ${error.message}` }
    }

    revalidatePath('/broadcasts')
    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}

// Генерация индивидуального сообщения через OpenRouter (или Groq как фолбэк)
export async function generateBroadcastMessage(clientId: string, scenarioTitle: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    // Загружаем данные клиента
    const { data: client, error } = await supabase
      .from('client_segments')
      .select('name, phone, total_orders, last_order_date, rfm_segment, days_since_last_order')
      .eq('id', clientId)
      .single()

    if (error || !client) {
      return { success: false as const, error: 'Клиент не найден' }
    }

    const openRouterKey = (process.env.OPENROUTER_API_KEY ?? '').trim()
    const groqKey = (process.env.GROQ_API_KEY ?? '').trim()

    if (!openRouterKey && !groqKey) {
      return { success: false as const, error: 'Ключи ИИ-генерации (OpenRouter или Groq) не настроены на сервере.' }
    }

    // Формируем детальный промпт
    const prompt = `Ты — менеджер заботы о клиентах профессиональной химчистки ковров, штор и мягкой мебели "Dara Clean" (мы находимся в городе Алматы).
Напиши индивидуальное приветственное/напоминающее сообщение в WhatsApp для клиента.

Данные клиента:
- Имя: ${client.name}
- Сегмент лояльности: ${client.rfm_segment}
- Всего заказов у нас ранее: ${client.total_orders}
- Дата последнего заказа: ${client.last_order_date || 'нет заказов'} (дней с последнего заказа: ${client.days_since_last_order ?? 'неизвестно'})

Повод для обращения (сценарий рассылки):
"${scenarioTitle}"

ПРАВИЛА И ОГРАНИЧЕНИЯ (ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ):
1. Обращайся к клиенту вежливо по имени.
2. Пиши в живом, дружелюбном и заботливом тоне, словно менеджер пишет сообщение вручную конкретно этому человеку. Избегай шаблонных фраз авто-рассылок.
3. Категорически ЗАПРЕЩЕНО использовать явные спам-слова, из-за которых WhatsApp блокирует аккаунты: "акция", "скидка", "купи", "дешево", "распродажа", "успей", "закажи". Вместо них используй мягкие аналоги: "приятный бонус", "особые условия для вас", "хотели освежить ваши ковры", "сделать полезный подарок", "чистота и уют".
4. Учти историю клиента:
   - Если клиент "Постоянный" или "Повторный" (total_orders >= 2): поблагодари за то, что доверяет нам чистоту своего дома.
   - Если последний заказ был давно (сегмент "В риске" или "Потерянный"): аккуратно спроси, как поживают ковры после нашей прошлой чистки, не пора ли их обновить.
5. Интегрируй выбранный сценарий логично в текст (например, если сценарий про "Лето: пыль и пух", упомяни, что летом из-за открытых окон летит пыль и тополиный пух, поэтому важно почистить ковры для здоровья близких).
6. В конце сообщения ОБЯЗАТЕЛЬНО задай один вовлекающий вопрос, на который клиент захочет ответить (например: "Подскажите, удобно ли будет, если наш курьер заедет к вам на этой неделе, чтобы забрать ковры?").
7. В самом конце сообщения (на отдельной новой строке) добавь ненавязчивую фразу о возможности отказаться (мягкий opt-out): "Если вам сейчас не актуально наше предложение, просто напишите мне 'стоп', и я больше не буду писать."
8. Текст должен быть на русском языке. Объем сообщения: 3-5 предложений (не пиши длинные тексты, пиши кратко и по делу). Без цен и списков услуг.

Выведи только готовый текст сообщения, без каких-либо вводных слов или кавычек.`

    let generatedText = ''

    if (openRouterKey) {
      // Запрос к OpenRouter. Свой try: при таймауте/сетевом сбое НЕ прерываем
      // генерацию, а падаем в Groq-fallback ниже (как при !response.ok).
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(20_000),
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://dara-clean-crm.vercel.app',
            'X-Title': 'Dara Clean CRM',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          generatedText = data.choices?.[0]?.message?.content?.trim() || ''
        } else {
          console.warn('OpenRouter failed, trying fallback to Groq...', await response.text())
        }
      } catch (err) {
        console.warn('OpenRouter request failed (timeout/network), trying Groq fallback:', err)
      }
    }

    // Если OpenRouter не сработал или ключ отсутствует, а GroqKey есть — делаем фолбэк на Groq
    if (!generatedText && groqKey) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        generatedText = data.choices?.[0]?.message?.content?.trim() || ''
      } else {
        console.error('Groq generation failed:', await response.text())
        return { success: false as const, error: 'Ошибка ИИ-генерации. Попробуйте ещё раз.' }
      }
    }

    if (!generatedText) {
      return { success: false as const, error: 'Не удалось сгенерировать сообщение ИИ.' }
    }

    // Чистим текст от возможных кавычек по краям
    if (generatedText.startsWith('"') && generatedText.endsWith('"')) {
      generatedText = generatedText.substring(1, generatedText.length - 1)
    }

    return { success: true as const, text: generatedText }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'Внутренняя ошибка генерации' }
  }
}

// Отправка WhatsApp сообщения через активный канал Wazzup (общий модуль lib/wazzup/send).
// Выбор канала/ключа и логирование — внутри sendWhatsAppViaWazzup.
export async function sendWhatsAppMessage(phone: string, text: string) {
  // Server action отвечает на любой POST — проверяем сессию (anti-anonymous).
  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false as const, error: 'Не авторизован' }
  }
  return sendWhatsAppViaWazzup({ phone, text, managerId: user.id })
}

// Логирование результатов рассылки в БД
export async function logBroadcastAttempt(params: {
  clientId: string
  scenario: string
  messageText: string
  status: 'sent' | 'failed'
  errorMessage?: string
}) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    // 1. Записываем в broadcast_logs
    const { error: logError } = await supabase
      .from('broadcast_logs')
      .insert({
        client_id: params.clientId,
        manager_id: user.id,
        scenario: params.scenario,
        message_text: params.messageText,
        status: params.status,
        error_message: params.errorMessage || null,
      })

    if (logError) {
      console.error('Error writing to broadcast_logs:', logError.message)
    }

    // 2. Добавляем запись в call_logs, чтобы отображалось в общей истории контактов
    // Для рассылок запишем статус 'reached', sub_status 'sent_whatsapp'
    if (params.status === 'sent') {
      const { error: callLogError } = await supabase
        .from('call_logs')
        .insert({
          client_id: params.clientId,
          manager_id: user.id,
          status: 'reached',
          sub_status: 'sent_whatsapp',
          notes: `WhatsApp рассылка по сценарию "${params.scenario}": «${params.messageText.slice(0, 80)}...»`,
        })

      if (callLogError) {
        console.error('Error writing to call_logs:', callLogError.message)
      }
      
      // Обновляем дату последнего контакта клиента (last_called_at)
      const { error: clientUpdateError } = await supabase
        .from('clients')
        .update({ last_called_at: new Date().toISOString() })
        .eq('id', params.clientId)
        
      if (clientUpdateError) {
        console.error('Error updating last_called_at:', clientUpdateError.message)
      }
    }

    return { success: true as const }
  } catch (err: any) {
    console.error('logBroadcastAttempt exception:', err)
    return { success: false as const, error: err.message || 'Внутренняя ошибка логирования' }
  }
}

// Получение истории отправленных рассылок
export async function getBroadcastLogs(): Promise<BroadcastLogEntry[]> {
  try {
    const supabase = await createSupabaseClient()
    const { data, error } = await supabase
      .from('broadcast_logs')
      .select('id, client_id, manager_id, scenario, message_text, status, error_message, sent_at, clients(name, phone)')
      .order('sent_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Error fetching broadcast logs:', error.message)
      return []
    }

    // Для получения имен менеджеров
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, email')

    const profilesMap = new Map<string, string>()
    profiles?.forEach((p) => {
      profilesMap.set(p.id, p.name || p.email.split('@')[0])
    })

    return (data || []).map((row: any) => {
      const client = row.clients as any
      return {
        id: row.id,
        client_id: row.client_id,
        client_name: client?.name || 'Без имени',
        client_phone: client?.phone || '',
        manager_id: row.manager_id,
        manager_name: profilesMap.get(row.manager_id) || 'Менеджер',
        scenario: row.scenario,
        message_text: row.message_text,
        status: row.status,
        error_message: row.error_message,
        sent_at: row.sent_at,
      }
    })
  } catch (err) {
    console.error('getBroadcastLogs error:', err)
    return []
  }
}
