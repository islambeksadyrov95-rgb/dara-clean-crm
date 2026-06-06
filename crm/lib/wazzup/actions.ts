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

    const wazzupApiKey = process.env.WAZZUP_API_KEY || '69c3898008814f949d6adb8ed09b5076'

    const managerName = user.user_metadata?.name || user.email?.split('@')[0] || 'Менеджер'

    const payload = {
      user: {
        id: user.id,
        name: managerName,
      },
      chat: {
        id: normalizedPhoneNum,
        type: 'whatsapp',
      },
    }

    console.log(`Requesting Wazzup iframe for manager ${managerName} and phone ${normalizedPhoneNum}...`)

    const response = await fetch('https://api.wazzup24.ru/v1/iframe', {
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
