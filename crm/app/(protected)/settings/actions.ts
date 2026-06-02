'use server'

import { createClient } from '@/lib/supabase/server'

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

export async function getSettings() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('crm_settings')
    .select('key, value')

  const map: Record<string, unknown> = {}
  data?.forEach((row) => { map[row.key] = row.value })

  const defaultPlan: SalesPlan = { avg_check: 17000, calls_per_day: 40, target_conversion: 12, plan_orders_per_day: 5, plan_revenue_per_day: 85000 }

  return {
    discounts: (map.discounts ?? { new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 }) as Discounts,
    scripts: (map.scripts ?? {}) as Scripts,
    dayTarget: (typeof map.day_target === 'number' ? map.day_target : 40) as number,
    salesPlan: (map.sales_plan ?? defaultPlan) as SalesPlan,
  }
}

export async function updateSetting(key: string, value: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.user_metadata?.role !== 'admin') {
    return { success: false as const, error: 'Только админ может менять настройки' }
  }

  const { error } = await supabase
    .from('crm_settings')
    .upsert({ key, value: JSON.parse(JSON.stringify(value)), updated_at: new Date().toISOString() })

  if (error) return { success: false as const, error: error.message }
  return { success: true as const }
}
