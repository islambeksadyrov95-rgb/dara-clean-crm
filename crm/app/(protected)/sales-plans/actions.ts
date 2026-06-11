'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import * as XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'

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

// Импорт планов из Excel на весь год
export async function importSalesPlansFromExcel(year: number) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    if (user.user_metadata?.role !== 'admin') {
      return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
    }

    // Получаем список менеджеров из БД
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, email, role')
      .neq('role', 'admin')

    if (profilesError || !profiles) {
      return { success: false as const, error: `Ошибка получения менеджеров: ${profilesError?.message}` }
    }

    // 3. Читаем Excel файл
    const filePath = path.join(process.cwd(), 'Мотивация отдела продаж - повторные - ИСПРАВЛЕНО_V2.xlsx')
    if (!fs.existsSync(filePath)) {
      return { success: false as const, error: 'Файл Мотивация отдела продаж - повторные - ИСПРАВЛЕНО_V2.xlsx не найден в корне проекта' }
    }

    const wb = XLSX.readFile(filePath)
    const sheet = wb.Sheets['Планы по категориям']
    if (!sheet) {
      return { success: false as const, error: 'Лист "Планы по категориям" не найден в Excel файле' }
    }

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]
    const nameRow = data[4] // Строка 5 (индекс 4) с именами менеджеров
    if (!nameRow) {
      return { success: false as const, error: 'Не удалось прочитать имена менеджеров из строки 5 в Excel' }
    }

    // Сопоставление менеджеров из БД с колонками Excel
    const managerMappings: { profile: any; offset: number }[] = []
    const skippedNames: string[] = []

    // Вытащим уникальные имена из nameRow (колонки C, D, E - индексы 2, 3, 4)
    const excelNames = [nameRow[2], nameRow[3], nameRow[4]].filter(Boolean) as string[]

    profiles.forEach(profile => {
      const pName = profile.name.toLowerCase().trim()
      let offset = -1;
      for (let i = 2; i <= 4; i++) {
        if (nameRow[i] && nameRow[i].toLowerCase().trim() === pName) {
          offset = i - 1; // Смещение относительно базы
          break;
        }
      }

      if (offset === -1) {
        const emailPrefix = profile.email.split('@')[0].toLowerCase()
        for (let i = 2; i <= 4; i++) {
          if (nameRow[i] && nameRow[i].toLowerCase().trim().includes(emailPrefix)) {
            offset = i - 1;
            break;
          }
        }
      }

      if (offset !== -1) {
        managerMappings.push({ profile, offset })
      }
    })

    // Выясним, какие имена из Excel не сопоставились с БД
    excelNames.forEach(eName => {
      const isMapped = managerMappings.some(m => m.profile.name.toLowerCase().trim() === eName.toLowerCase().trim())
      if (!isMapped && eName !== 'Общий план') {
        skippedNames.push(eName)
      }
    })

    if (managerMappings.length === 0) {
      return { success: false as const, error: 'Не удалось сопоставить ни одного менеджера из БД с колонками в Excel' }
    }

    const upsertData: any[] = []

    // Строки 6-17 (индексы 5-16) соответствуют месяцам 1-12
    for (let monthVal = 1; monthVal <= 12; monthVal++) {
      const rowIdx = 4 + monthVal
      const row = data[rowIdx]
      if (!row) continue

      managerMappings.forEach(mapping => {
        const carpetsVal = Number(row[1 + mapping.offset]) || 0
        const furnitureVal = Number(row[5 + mapping.offset]) || 0
        const curtainsVal = Number(row[9 + mapping.offset]) || 0
        const dryCleanVal = Number(row[13 + mapping.offset]) || 0
        const blanketsVal = Number(row[17 + mapping.offset]) || 0
        const repeatVal = Number(row[21 + mapping.offset]) || 0

        upsertData.push({
          manager_id: mapping.profile.id,
          month: monthVal,
          year: year,
          carpets_target: carpetsVal,
          furniture_target: furnitureVal,
          curtains_target: curtainsVal,
          dry_clean_target: dryCleanVal,
          blankets_target: blanketsVal,
          repeat_target: repeatVal
        })
      })
    }

    // Выполняем upsert в БД
    const { error: upsertError } = await supabase
      .from('sales_plans')
      .upsert(upsertData, { onConflict: 'manager_id,month,year' })

    if (upsertError) {
      return { success: false as const, error: `Ошибка импорта в БД: ${upsertError.message}` }
    }

    revalidatePath('/sales-plans')
    revalidatePath('/motivation')

    const importedNames = managerMappings.map(m => m.profile.name).join(', ')
    let message = `Успешно импортировано ${upsertData.length} записей планов для менеджеров: ${importedNames} на ${year} год.`
    if (skippedNames.length > 0) {
      message += ` Пропущены менеджеры из Excel (нет в CRM): ${skippedNames.join(', ')}.`
    }

    return { success: true as const, message }
  } catch (err: any) {
    console.error('importSalesPlansFromExcel error:', err)
    return { success: false as const, error: err.message || 'Внутренняя ошибка сервера' }
  }
}
