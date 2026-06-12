'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { parseSegmentConfig, type SegmentConfig } from '@/lib/segments'
import { getUserRole } from '@/lib/auth/get-user-role'

export type Discounts = {
  new: number
  repeat: number
  regular: number
  at_risk: number
  lost: number
}

export type Scripts = Record<string, string>

export type SalesPlan = {
  avg_check: number
  calls_per_day: number
  target_conversion: number
  plan_orders_per_day: number
  plan_revenue_per_day: number
}

export type MotivationSettings = {
  rates: { carpets: number; furniture: number; curtains: number; repeat: number; dryClean?: number; blankets?: number }
  repeatShare: number
  jackpot: number
  plans: Record<string, { carpets: number; furniture: number; curtains: number; repeat: number; dryClean?: number; blankets?: number }>
  salary?: number
  kpiBonus?: number
  kpiAvgCheckTarget?: number
  kpiCallConversionTarget?: number
}

export async function getSettings() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAdmin = getUserRole(user ?? null) === 'admin'

  const { data } = await supabase
    .from('crm_settings')
    .select('key, value')

  const map: Record<string, unknown> = {}
  data?.forEach((row) => { map[row.key] = row.value })

  const defaultPlan: SalesPlan = { avg_check: 17000, calls_per_day: 40, target_conversion: 12, plan_orders_per_day: 5, plan_revenue_per_day: 85000 }

  const defaultMotivation: MotivationSettings = {
    // Эталонные ставки из формул Excel (лист «Настройки»).
    rates: { carpets: 0.015, furniture: 0.03, curtains: 0.03, repeat: 0.03, dryClean: 0.005, blankets: 0.03 },
    repeatShare: 0.30,
    jackpot: 50000,
    plans: {
      "Елена": { carpets: 500000, furniture: 400000, curtains: 300000, repeat: 360000, dryClean: 0, blankets: 0 },
      "Самал": { carpets: 450000, furniture: 350000, curtains: 250000, repeat: 300000, dryClean: 0, blankets: 0 },
      "Рауза": { carpets: 400000, furniture: 300000, curtains: 200000, repeat: 250000, dryClean: 0, blankets: 0 }
    },
    salary: 150000,
    kpiBonus: 25000,
    kpiAvgCheckTarget: 19500,
    kpiCallConversionTarget: 0.25,
  }

  return {
    discounts: (map.discounts ?? { new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 }) as Discounts,
    scripts: (map.scripts ?? {}) as Scripts,
    dayTarget: (typeof map.day_target === 'number' ? map.day_target : 40) as number,
    salesPlan: (map.sales_plan ?? defaultPlan) as SalesPlan,
    motivationConfig: (map.motivation_config ?? defaultMotivation) as MotivationSettings,
    vpbxToken: (isAdmin ? (map.vpbx_token ?? '') : '') as string,
    vpbxUrl: (map.vpbx_url ?? 'https://cloudpbx.beeline.kz/VPBX') as string,
    vpbxProfileId: (isAdmin ? (map.vpbx_profile_id ?? '') : '') as string,
    vpbxWebhookSecret: (isAdmin ? (map.vpbx_webhook_secret ?? '') : '') as string,
  }
}

export async function updateSetting(key: string, value: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    return { success: false as const, error: 'Только админ может менять настройки' }
  }

  const { error } = await supabase
    .from('crm_settings')
    .upsert({ key, value: JSON.parse(JSON.stringify(value)), updated_at: new Date().toISOString() })

  if (error) return { success: false as const, error: error.message }
  return { success: true as const }
}

export type ManagerProfile = {
  id: string
  email: string
  name: string | null
  role: string
  sip_extension: string | null
  is_active: boolean
  can_call: boolean
}

export async function getManagersProfiles(): Promise<ManagerProfile[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    throw new Error('Доступ запрещен. Требуются права администратора.')
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, role, sip_extension, is_active')
    .order('role', { ascending: true })

  if (error) throw new Error(error.message)

  // Право звонить хранится картой в crm_settings (без отдельной колонки/миграции).
  const { data: accessRow } = await supabase
    .from('crm_settings')
    .select('value')
    .eq('key', 'vpbx_can_call')
    .maybeSingle()
  const canCallMap = (accessRow?.value ?? {}) as Record<string, boolean>

  return (data ?? []).map(p => ({
    ...p,
    is_active: p.is_active !== false, // по умолчанию true
    can_call: canCallMap[p.id] !== false, // по умолчанию разрешено
  }))
}

export async function updateTelephonySettings(payload: {
  vpbxToken: string
  vpbxUrl: string
  vpbxProfileId: string
  vpbxWebhookSecret: string
  managers: { id: string; sip_extension: string; is_active: boolean; can_call: boolean }[]
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
  }

  const now = new Date().toISOString()
  // Auto-generate a webhook secret on first save so the integration can be enabled.
  const webhookSecret = payload.vpbxWebhookSecret.trim() || crypto.randomUUID()

  // Карта прав «может звонить» (по умолчанию разрешено; храним только запреты-явные значения).
  const canCallMap: Record<string, boolean> = {}
  for (const mgr of payload.managers) canCallMap[mgr.id] = mgr.can_call

  // 1. Сохраняем общие настройки телефонии в crm_settings
  const settingsRows = [
    { key: 'vpbx_token', value: payload.vpbxToken.trim() },
    { key: 'vpbx_url', value: payload.vpbxUrl.trim() },
    { key: 'vpbx_profile_id', value: payload.vpbxProfileId.trim() },
    { key: 'vpbx_webhook_secret', value: webhookSecret },
    { key: 'vpbx_can_call', value: canCallMap },
  ].map((row) => ({ ...row, updated_at: now }))

  const { error: settingsError } = await supabase.from('crm_settings').upsert(settingsRows)

  if (settingsError) {
    return { success: false as const, error: `Ошибка сохранения настроек API: ${settingsError.message}` }
  }

  // 2. Сохраняем SIP номера и статус распределения менеджеров
  const adminSupabase = createAdminClient()
  for (const mgr of payload.managers) {
    const sip = mgr.sip_extension.trim() || null
    
    // Обновляем public.profiles
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        sip_extension: sip,
        is_active: mgr.is_active,
        updated_at: now
      })
      .eq('id', mgr.id)

    if (profileErr) {
      console.error(`Failed to update profile for ${mgr.id}:`, profileErr.message)
    }

    // Также обновляем метаданные в auth для совместимости
    try {
      await adminSupabase.auth.admin.updateUserById(mgr.id, {
        user_metadata: {
          sip_extension: sip,
        }
      })
    } catch (authErr: any) {
      console.error(`Failed to update auth metadata for ${mgr.id}:`, authErr.message)
    }
  }

  return { success: true as const }
}

// Правила сегментации (названия, цвета, пороги). Источник правды — crm_settings.segment_rules.
export async function getSegmentRules(): Promise<SegmentConfig> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('crm_settings')
    .select('value')
    .eq('key', 'segment_rules')
    .maybeSingle()
  return parseSegmentConfig(data?.value)
}

export async function updateSegmentRules(config: SegmentConfig) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    return { success: false as const, error: 'Только админ может менять правила сегментации' }
  }

  const segments = config?.segments
  if (!Array.isArray(segments) || segments.length === 0) {
    return { success: false as const, error: 'Нужен хотя бы один сегмент' }
  }
  const names = segments.map((s) => (s.name ?? '').trim())
  if (names.some((n) => !n)) {
    return { success: false as const, error: 'У каждого сегмента должно быть название' }
  }
  if (new Set(names).size !== names.length) {
    return { success: false as const, error: 'Названия сегментов должны быть уникальны' }
  }
  if (!segments.some((s) => s.type === 'default')) {
    return { success: false as const, error: 'Нужен один сегмент «остальные» (тип по умолчанию)' }
  }

  // Нормализуем перед записью (отсекает мусорные поля, приводит типы).
  const clean = parseSegmentConfig(config)
  const { error } = await supabase
    .from('crm_settings')
    .upsert({ key: 'segment_rules', value: JSON.parse(JSON.stringify(clean)), updated_at: new Date().toISOString() })

  if (error) return { success: false as const, error: error.message }

  revalidatePath('/settings/segments')
  revalidatePath('/clients')
  revalidatePath('/broadcasts')
  return { success: true as const }
}
