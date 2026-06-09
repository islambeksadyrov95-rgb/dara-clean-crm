'use server'

import { createClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'

export async function getWazzupChatUrl(clientPhone: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const normalizedPhoneNum = normalizePhone(clientPhone)
    if (!normalizedPhoneNum || normalizedPhoneNum.length < 10) {
      return { success: false as const, error: 'Некорректный номер телефона клиента' }
    }

    const wazzupApiKey = process.env.WAZZUP_API_KEY
    if (!wazzupApiKey) {
      return { success: false as const, error: 'Интеграция с Wazzup не настроена на сервере (отсутствует API-ключ).' }
    }

    const managerName = user.user_metadata?.name || user.email?.split('@')[0] || 'Менеджер'

    // 1. Синхронизируем пользователя с Wazzup, чтобы избежать ошибки INVALID_USER
    try {
      const syncResponse = await fetch('https://api.wazzup24.com/v3/users', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${wazzupApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: user.id,
            name: managerName,
          }
        ]),
      })

      if (!syncResponse.ok) {
        console.warn('Wazzup user sync warning:', await syncResponse.text())
      }
    } catch (syncError) {
      console.error('Wazzup user sync exception:', syncError)
    }

    // 2. Формируем payload для v3/iframe
    const payload = {
      user: {
        id: user.id,
        name: managerName,
      },
      scope: 'card' as const,
      filter: [
        {
          chatType: 'whatsapp' as const,
          chatId: normalizedPhoneNum,
        }
      ]
    }

    console.log(`Requesting Wazzup v3 iframe for manager ${managerName} and phone ${normalizedPhoneNum}...`)

    const response = await fetch('https://api.wazzup24.com/v3/iframe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${wazzupApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Wazzup API Error:', errText)
      return { success: false as const, error: `Wazzup API Error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.url) {
      return { success: false as const, error: 'Не удалось получить ссылку на чат от Wazzup' }
    }

    return { success: true as const, url: data.url as string }
  } catch (error: any) {
    console.error('Wazzup get iframe url exception:', error)
    return { success: false as const, error: error.message || 'Внутренняя ошибка при запросе чата' }
  }
}

export async function getWazzupGlobalChatUrl(channelId?: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const wazzupApiKey = process.env.WAZZUP_API_KEY
    if (!wazzupApiKey) {
      return { success: false as const, error: 'Интеграция с Wazzup не настроена на сервере (отсутствует API-ключ).' }
    }

    const managerName = user.user_metadata?.name || user.email?.split('@')[0] || 'Менеджер'
    const wazzupUserId = channelId ? `${user.id}_${channelId}` : user.id

    // 1. Синхронизируем пользователя с Wazzup, чтобы избежать ошибки INVALID_USER
    try {
      const syncResponse = await fetch('https://api.wazzup24.com/v3/users', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${wazzupApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: wazzupUserId,
            name: managerName,
          }
        ]),
      })

      if (!syncResponse.ok) {
        console.warn('Wazzup user sync warning:', await syncResponse.text())
      }
    } catch (syncError) {
      console.error('Wazzup user sync exception:', syncError)
    }

    // 2. Формируем payload для v3/iframe (global)
    const payload = {
      user: {
        id: wazzupUserId,
        name: managerName,
      },
      scope: 'global' as const,
    }

    console.log(`Requesting Wazzup v3 global iframe for manager ${managerName}...`)

    const response = await fetch('https://api.wazzup24.com/v3/iframe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${wazzupApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Wazzup API Error:', errText)
      return { success: false as const, error: `Wazzup API Error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.url) {
      return { success: false as const, error: 'Не удалось получить ссылку на чат от Wazzup' }
    }

    return { success: true as const, url: data.url as string }
  } catch (error: any) {
    console.error('Wazzup get global iframe url exception:', error)
    return { success: false as const, error: error.message || 'Внутренняя ошибка при запросе чата' }
  }
}
