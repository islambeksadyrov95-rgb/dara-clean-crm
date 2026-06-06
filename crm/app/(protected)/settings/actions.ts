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

export type MotivationSettings = {
  rates: { carpets: number; furniture: number; curtains: number; repeat: number }
  repeatShare: number
  jackpot: number
  plans: Record<string, { carpets: number; furniture: number; curtains: number; repeat: number }>
}

export async function getSettings() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('crm_settings')
    .select('key, value')

  const map: Record<string, unknown> = {}
  data?.forEach((row) => { map[row.key] = row.value })

  const defaultPlan: SalesPlan = { avg_check: 17000, calls_per_day: 40, target_conversion: 12, plan_orders_per_day: 5, plan_revenue_per_day: 85000 }

  const defaultMotivation: MotivationSettings = {
    rates: { carpets: 0.05, furniture: 0.05, curtains: 0.05, repeat: 0.02 },
    repeatShare: 0.30,
    jackpot: 50000,
    plans: {
      "Елена": { carpets: 500000, furniture: 400000, curtains: 300000, repeat: 360000 },
      "Самал": { carpets: 450000, furniture: 350000, curtains: 250000, repeat: 300000 },
      "Рауза": { carpets: 400000, furniture: 300000, curtains: 200000, repeat: 250000 }
    }
  }

  return {
    discounts: (map.discounts ?? { new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 }) as Discounts,
    scripts: (map.scripts ?? {}) as Scripts,
    dayTarget: (typeof map.day_target === 'number' ? map.day_target : 40) as number,
    salesPlan: (map.sales_plan ?? defaultPlan) as SalesPlan,
    motivationConfig: (map.motivation_config ?? defaultMotivation) as MotivationSettings,
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
