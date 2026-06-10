'use server'

import { createClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'

export async function makeSipCall(clientPhone: string, externalCallId?: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const sipExtension = user.user_metadata?.sip_extension || user.user_metadata?.sip_number
    if (!sipExtension) {
      return {
        success: false as const,
        error: 'Внутренний SIP-номер не настроен. Пожалуйста, укажите его в Личных настройках (раздел Настройки).'
      }
    }

    const normalizedClientPhone = normalizePhone(clientPhone)
    if (!normalizedClientPhone || normalizedClientPhone.length < 10) {
      return { success: false as const, error: 'Некорректный номер телефона клиента' }
    }

    // Получаем настройки из crm_settings
    const { data: dbSettings } = await supabase
      .from('crm_settings')
      .select('key, value')
      .in('key', ['vpbx_url', 'vpbx_token'])

    const settingsMap: Record<string, string> = {}
    dbSettings?.forEach((row) => {
      if (row.value) {
        settingsMap[row.key] = typeof row.value === 'string' ? row.value : String(row.value)
      }
    })

    const vpbxUrl = (settingsMap.vpbx_url || process.env.BEELINE_VPBX_URL || 'https://cloudpbx.beeline.kz/VPBX').trim()
    const vpbxToken = (settingsMap.vpbx_token || process.env.BEELINE_VPBX_TOKEN || '').trim()

    if (!vpbxToken) {
      return { success: false as const, error: 'Интеграция с телефонией не настроена (отсутствует токен АТС в настройках).' }
    }

    // Собираем URL с query параметрами
    const url = new URL(`${vpbxUrl}/Api/MakeCall2`)
    url.searchParams.append('abonentNumber', String(sipExtension))
    url.searchParams.append('number', normalizedClientPhone)
    if (externalCallId) {
      url.searchParams.append('externalCallId', externalCallId)
    }

    console.log(`Initiating SIP call: ${url.toString()} with token ${vpbxToken.substring(0, 5)}...`)

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-VPBX-API-AUTH-TOKEN': vpbxToken,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('VPBX API error:', errorText)
      return { success: false as const, error: `Ошибка АТС: ${response.status} ${errorText || response.statusText}` }
    }

    let uuid = ''
    try {
      const data = await response.json()
      uuid = data.uuid || data.Id || ''
    } catch {
      // Игнорируем ошибки парсинга, если вернулся не JSON
    }

    return { success: true as const, uuid }
  } catch (error: any) {
    console.error('SIP Call Exception:', error)
    return { success: false as const, error: error.message || 'Внутренняя ошибка при совершении вызова' }
  }
}
