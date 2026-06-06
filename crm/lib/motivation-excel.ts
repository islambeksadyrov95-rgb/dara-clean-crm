import * as XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface MotivationConfig {
  rates: {
    carpets: number
    furniture: number
    curtains: number
    repeat: number
  }
  repeatShare: number
  jackpot: number
  plans: {
    carpets: number
    furniture: number
    curtains: number
    repeat: number
  }
  managerName: string
}

const DEFAULT_CONFIG: Omit<MotivationConfig, 'managerName'> = {
  rates: {
    carpets: 0.05,
    furniture: 0.05,
    curtains: 0.05,
    repeat: 0.02,
  },
  repeatShare: 0.30,
  jackpot: 50000,
  plans: {
    carpets: 500000,
    furniture: 400000,
    curtains: 300000,
    repeat: 360000,
  }
}

export async function getMotivationConfig(managerEmail: string): Promise<MotivationConfig> {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
  
  // 1. Находим пользователя по email через Admin API
  let managerId = ''
  let managerName = managerEmail.split('@')[0]
  managerName = managerName.charAt(0).toUpperCase() + managerName.slice(1)
  
  try {
    const { data: usersData } = await adminSupabase.auth.admin.listUsers()
    const foundUser = usersData?.users?.find(
      (u) => u.email?.toLowerCase() === managerEmail.toLowerCase()
    )
    if (foundUser) {
      managerId = foundUser.id
      managerName = foundUser.user_metadata?.name || managerName
    }
  } catch (err) {
    console.error('Ошибка получения пользователей в getMotivationConfig:', err)
  }

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  let rates = { ...DEFAULT_CONFIG.rates }
  let repeatShare = DEFAULT_CONFIG.repeatShare
  let jackpot = DEFAULT_CONFIG.jackpot
  let plans = { ...DEFAULT_CONFIG.plans }

  // 2. Сначала загружаем общие настройки мотивации (ставки, джекпот) из crm_settings
  try {
    const { data: dbData } = await supabase
      .from('crm_settings')
      .select('value')
      .eq('key', 'motivation_config')
      .single()

    if (dbData && dbData.value) {
      const dbConfig = dbData.value as any
      rates = {
        carpets: dbConfig.rates?.carpets ?? DEFAULT_CONFIG.rates.carpets,
        furniture: dbConfig.rates?.furniture ?? DEFAULT_CONFIG.rates.furniture,
        curtains: dbConfig.rates?.curtains ?? DEFAULT_CONFIG.rates.curtains,
        repeat: dbConfig.rates?.repeat ?? DEFAULT_CONFIG.rates.repeat,
      }
      repeatShare = dbConfig.repeatShare !== undefined ? Number(dbConfig.repeatShare) : DEFAULT_CONFIG.repeatShare
      jackpot = dbConfig.jackpot !== undefined ? Number(dbConfig.jackpot) : DEFAULT_CONFIG.jackpot
    }
  } catch (dbErr) {
    console.warn('Не удалось получить общие настройки мотивации из crm_settings:', dbErr)
  }

  // 3. Загружаем планы из таблицы sales_plans для конкретного пользователя на текущий месяц
  let planLoadedFromDb = false
  if (managerId) {
    try {
      const { data: dbPlan } = await supabase
        .from('sales_plans')
        .select('carpets_target, furniture_target, curtains_target, repeat_target')
        .eq('manager_id', managerId)
        .eq('month', currentMonth)
        .eq('year', currentYear)
        .maybeSingle()

      if (dbPlan) {
        plans = {
          carpets: Number(dbPlan.carpets_target) || 0,
          furniture: Number(dbPlan.furniture_target) || 0,
          curtains: Number(dbPlan.curtains_target) || 0,
          repeat: Number(dbPlan.repeat_target) || 0,
        }
        planLoadedFromDb = true
      }
    } catch (err) {
      console.warn('Не удалось получить планы из sales_plans:', err)
    }
  }

  // 4. Если планов в БД нет, пробуем получить их из Excel-файла в качестве резервного варианта (фоллбэка)
  if (!planLoadedFromDb) {
    try {
      const filePath = path.join(process.cwd(), 'Мотивация отдела продаж.xlsx')
      if (fs.existsSync(filePath)) {
        const wb = XLSX.readFile(filePath)
        const plansSheet = wb.Sheets['Планы по категориям']
        
        if (plansSheet) {
          const rowIdx = 5 + currentMonth // Строка 6 - январь, 7 - февраль...
          
          // Определяем столбцы на основе имени менеджера
          let carpetsCol = 'C'
          let furnitureCol = 'G'
          let curtainsCol = 'K'
          let repeatCol = 'O'

          const cleanName = managerName.toLowerCase()
          if (cleanName.includes('самал') || cleanName.includes('samal')) {
            carpetsCol = 'D'
            furnitureCol = 'H'
            curtainsCol = 'L'
            repeatCol = 'P'
          } else if (cleanName.includes('рауза') || cleanName.includes('rauza')) {
            carpetsCol = 'E'
            furnitureCol = 'I'
            curtainsCol = 'M'
            repeatCol = 'Q'
          }

          const getPlanVal = (col: string, row: number, def: number) => {
            const cell = plansSheet[`${col}${row}`]
            if (cell && cell.v !== undefined) {
              const val = Number(cell.v)
              return isNaN(val) ? def : val
            }
            return def
          }

          plans.carpets = getPlanVal(carpetsCol, rowIdx, plans.carpets)
          plans.furniture = getPlanVal(furnitureCol, rowIdx, plans.furniture)
          plans.curtains = getPlanVal(curtainsCol, rowIdx, plans.curtains)
          plans.repeat = getPlanVal(repeatCol, rowIdx, plans.repeat)
        }
      }
    } catch (e) {
      console.error('Ошибка при разборе Excel-файла мотивации:', e)
    }
  }

  return {
    rates,
    repeatShare,
    jackpot,
    plans,
    managerName
  }
}
