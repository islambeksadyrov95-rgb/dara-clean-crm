'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface ManagerSalesPlan {
  managerId: string
  name: string
  email: string
  carpetsTarget: number
  furnitureTarget: number
  curtainsTarget: number
  repeatTarget: number
  dryCleanTarget: number
  blanketsTarget: number
  exists: boolean
}

// Получение списка планов продаж для менеджеров
export async function getSalesPlans(month: number, year: number): Promise<ManagerSalesPlan[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return []
    }

    // 1. Получаем список менеджеров из public.profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, email, role')
      .neq('role', 'admin')

    if (profilesError || !profiles) {
      console.error('Error fetching managers from profiles:', profilesError?.message)
      return []
    }

    // 2. Получаем планы из таблицы sales_plans за указанный месяц/год
    const { data: dbPlans, error: dbError } = await supabase
      .from('sales_plans')
      .select('manager_id, carpets_target, furniture_target, curtains_target, repeat_target, dry_clean_target, blankets_target')
      .eq('month', month)
      .eq('year', year)

    if (dbError) {
      console.error('Error fetching db plans:', dbError.message)
    }

    interface DbPlanRow {
      manager_id: string
      carpets_target: number
      furniture_target: number
      curtains_target: number
      repeat_target: number
      dry_clean_target: number
      blankets_target: number
    }
    const plansMap = new Map<string, DbPlanRow>()
    dbPlans?.forEach((p) => {
      plansMap.set(p.manager_id, p as unknown as DbPlanRow)
    })

    // 3. Собираем финальный массив
    return profiles.map((p) => {
      const dbPlan = plansMap.get(p.id)
      const name = p.name || p.email.split('@')[0] || 'Без имени'
      
      return {
        managerId: p.id,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        email: p.email || '',
        carpetsTarget: dbPlan ? Number(dbPlan.carpets_target) : 0,
        furnitureTarget: dbPlan ? Number(dbPlan.furniture_target) : 0,
        curtainsTarget: dbPlan ? Number(dbPlan.curtains_target) : 0,
        repeatTarget: dbPlan ? Number(dbPlan.repeat_target) : 0,
        dryCleanTarget: dbPlan ? Number(dbPlan.dry_clean_target) : 0,
        blanketsTarget: dbPlan ? Number(dbPlan.blankets_target) : 0,
        exists: !!dbPlan,
      }
    })
  } catch (err) {
    console.error('getSalesPlans error:', err)
    return []
  }
}

// Сохранение планов продаж (только для админа)
export async function saveSalesPlans(
  month: number,
  year: number,
  plans: Omit<ManagerSalesPlan, 'name' | 'email' | 'exists'>[]
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (user.user_metadata?.role !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    // Подготавливаем записи для upsert
    const upsertData = plans.map((p) => ({
      manager_id: p.managerId,
      month,
      year,
      carpets_target: p.carpetsTarget,
      furniture_target: p.furnitureTarget,
      curtains_target: p.curtainsTarget,
      repeat_target: p.repeatTarget,
      dry_clean_target: p.dryCleanTarget,
      blankets_target: p.blanketsTarget,
    }))

    // Выполняем upsert (будет конфликт по manager_id, month, year)
    const { error } = await supabase
      .from('sales_plans')
      .upsert(upsertData, { onConflict: 'manager_id,month,year' })

    if (error) {
      return { success: false as const, error: `Ошибка базы данных: ${error.message}` }
    }

    revalidatePath('/sales-plans')
    revalidatePath('/motivation')
    return { success: true as const }
  } catch (err: any) {
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}
