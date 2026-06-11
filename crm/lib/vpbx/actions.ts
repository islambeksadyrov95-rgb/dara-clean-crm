'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidPhone, toDialDigits } from '@/lib/phone'
import { getUserRole } from '@/lib/auth/get-user-role'
import {
  getVpbxConfig,
  makeCall2,
  subscribe,
  getSubscriptions,
  deleteSubscriptions,
  getWebhookUrl,
  type VpbxSubscription,
} from '@/lib/vpbx/client'

/**
 * Initiates an outgoing Click-to-Call and records the call in vpbx_calls so the
 * webhook can correlate events back to it via externalCallId / uuid.
 */
export async function makeSipCall(clientPhone: string, clientId?: string) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    // Право звонить: админ — всегда; менеджеру можно запретить в Настройках → Телефония.
    if (getUserRole(user) !== 'admin') {
      const { data: accessRow } = await supabase
        .from('crm_settings')
        .select('value')
        .eq('key', 'vpbx_can_call')
        .maybeSingle()
      const accessMap = (accessRow?.value ?? {}) as Record<string, boolean>
      if (accessMap[user.id] === false) {
        return { success: false as const, error: 'Звонки отключены администратором. Обратитесь к руководителю.' }
      }
    }

    const sipExtension = user.user_metadata?.sip_extension || user.user_metadata?.sip_number
    if (!sipExtension) {
      return {
        success: false as const,
        error: 'Внутренний SIP-номер не настроен. Укажите его в Настройках → Личные настройки.',
      }
    }

    if (!isValidPhone(clientPhone)) {
      return { success: false as const, error: 'Некорректный номер телефона клиента' }
    }
    // Beeline MakeCall2 принимает номер без «+» (7XXXXXXXXXX).
    const dialNumber = toDialDigits(clientPhone)

    const config = await getVpbxConfig()
    if (!config.token) {
      return {
        success: false as const,
        error: 'Интеграция с телефонией не настроена (отсутствует токен АТС в настройках).',
      }
    }

    const externalCallId = `crm-${crypto.randomUUID()}`

    let uuid = ''
    try {
      const result = await makeCall2(config, {
        abonentNumber: String(sipExtension),
        number: dialNumber,
        externalCallId,
      })
      uuid = result.uuid
    } catch (err) {
      return { success: false as const, error: (err as Error).message }
    }

    // Record the outbound call (admin client bypasses RLS for the insert).
    const admin = createAdminClient()
    const { error: insertError } = await admin.from('vpbx_calls').insert({
      vpbx_uuid: uuid || null,
      external_call_id: externalCallId,
      direction: 'outbound',
      number_b: dialNumber,
      manager_id: user.id,
      client_id: clientId ?? null,
      started_at: new Date().toISOString(),
    })
    if (insertError) {
      console.error('[vpbx] failed to record outbound call:', insertError.message)
    }

    return { success: true as const, externalCallId, uuid }
  } catch (error) {
    console.error('SIP Call Exception:', error)
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Внутренняя ошибка при совершении вызова',
    }
  }
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || getUserRole(user) !== 'admin') {
    throw new Error('Доступ запрещен. Требуются права администратора.')
  }
  return user
}

export type VpbxSubscriptionStatus = {
  configured: boolean
  webhookUrl: string
  subscriptions: VpbxSubscription[]
}

/** Reads current VPBX event subscriptions for the settings page (admin only). */
export async function getVpbxSubscriptionStatus(): Promise<VpbxSubscriptionStatus> {
  await requireAdmin()
  const config = await getVpbxConfig()
  const configured = Boolean(config.token && config.profileId && config.webhookSecret)

  let subscriptions: VpbxSubscription[] = []
  if (configured) {
    try {
      subscriptions = await getSubscriptions(config)
    } catch (err) {
      console.error('[vpbx] failed to list subscriptions:', (err as Error).message)
    }
  }

  return { configured, webhookUrl: getWebhookUrl(config), subscriptions }
}

/** Creates/renews the company webhook subscription (admin only). */
export async function subscribeVpbx() {
  try {
    await requireAdmin()
    const config = await getVpbxConfig()
    if (!config.webhookSecret) {
      return { success: false as const, error: 'Сначала задайте секрет вебхука и сохраните настройки.' }
    }
    const sub = await subscribe(config, getWebhookUrl(config))
    return { success: true as const, subscriptionId: sub.subscriptionId, expiresAt: sub.expiresAt ?? null }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

/** Removes all company webhook subscriptions (admin only). */
export async function unsubscribeVpbx() {
  try {
    await requireAdmin()
    const config = await getVpbxConfig()
    await deleteSubscriptions(config)
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}
