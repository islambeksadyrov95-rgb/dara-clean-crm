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
    dryClean: number
    blankets: number
  }
  repeatShare: number
  jackpot: number
  plans: {
    carpets: number
    furniture: number
    curtains: number
    repeat: number
    dryClean: number
    blankets: number
  }
  managerName: string
  targetAvgCheck: number
  targetConversion: number
}

const DEFAULT_CONFIG: Omit<MotivationConfig, 'managerName'> = {
  rates: {
    carpets: 0.01, // 1.0%
    furniture: 0.015, // 1.5%
    curtains: 0.015, // 1.5%
    repeat: 0.03, // 3.0%
    dryClean: 0.005, // 0.5%
    blankets: 0.015, // 1.5%
  },
  repeatShare: 0.30,
  jackpot: 50000,
  plans: {
    carpets: 500000,
    furniture: 400000,
    curtains: 300000,
    repeat: 360000,
    dryClean: 0,
    blankets: 0,
  },
  targetAvgCheck: 17000,
  targetConversion: 12
}

export async function getMotivationConfig(
  managerEmail: string,
  month?: number,
  year?: number
): Promise<MotivationConfig> {
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
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + 5 * 60 * 60000)

  const currentMonth = month ?? (almatyNow.getMonth() + 1)
  const currentYear = year ?? almatyNow.getFullYear()

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
        dryClean: dbConfig.rates?.dryClean ?? DEFAULT_CONFIG.rates.dryClean,
        blankets: dbConfig.rates?.blankets ?? DEFAULT_CONFIG.rates.blankets,
      }
      repeatShare = dbConfig.repeatShare !== undefined ? Number(dbConfig.repeatShare) : DEFAULT_CONFIG.repeatShare
      jackpot = dbConfig.jackpot !== undefined ? Number(dbConfig.jackpot) : DEFAULT_CONFIG.jackpot
    }
  } catch (dbErr) {
    console.warn('Не удалось получить общие настройки мотивации из crm_settings:', dbErr)
  }

  // 3. Загружаем планы из таблицы sales_plans для конкретного пользователя на выбранный месяц
  let planLoadedFromDb = false
  if (managerId) {
    try {
      const { data: dbPlan } = await supabase
        .from('sales_plans')
        .select('carpets_target, furniture_target, curtains_target, repeat_target, dry_clean_target, blankets_target')
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
          dryClean: Number(dbPlan.dry_clean_target) || 0,
          blankets: Number(dbPlan.blankets_target) || 0,
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
      let filePath = path.join(process.cwd(), 'Мотивация отдела продаж - повторные - ФИНАЛ.xlsx')
      if (!fs.existsSync(filePath)) {
        filePath = path.join(process.cwd(), 'Мотивация отдела продаж.xlsx')
      }
      
      if (fs.existsSync(filePath)) {
        const wb = XLSX.readFile(filePath)
        const plansSheet = wb.Sheets['Планы по категориям']
        
        if (plansSheet) {
          const rowIdx = 5 + currentMonth // Строка 6 - январь, 7 - февраль...
          
          // Определяем столбцы на основе имени менеджера
          let carpetsCol = 'C'
          let furnitureCol = 'G'
          let curtainsCol = 'K'
          let dryCleanCol = 'O'
          let blanketsCol = 'S'
          let repeatCol = 'W'

          const cleanName = managerName.toLowerCase()
          if (cleanName.includes('самал') || cleanName.includes('samal')) {
            carpetsCol = 'D'
            furnitureCol = 'H'
            curtainsCol = 'L'
            dryCleanCol = 'P'
            blanketsCol = 'T'
            repeatCol = 'X'
          } else if (cleanName.includes('рауза') || cleanName.includes('rauza')) {
            carpetsCol = 'E'
            furnitureCol = 'I'
            curtainsCol = 'M'
            dryCleanCol = 'Q'
            blanketsCol = 'U'
            repeatCol = 'Y'
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
          plans.dryClean = getPlanVal(dryCleanCol, rowIdx, plans.dryClean)
          plans.blankets = getPlanVal(blanketsCol, rowIdx, plans.blankets)
          plans.repeat = getPlanVal(repeatCol, rowIdx, plans.repeat)
        }
      }
    } catch (e) {
      console.error('Ошибка при разборе Excel-файла мотивации:', e)
    }
  }

  // 5. Динамически считываем нормативы KPI (средний чек и конверсия)
  let targetConversion = DEFAULT_CONFIG.targetConversion
  let targetAvgCheck = DEFAULT_CONFIG.targetAvgCheck

  try {
    let filePath = path.join(process.cwd(), 'Мотивация отдела продаж - повторные - ФИНАЛ.xlsx')
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'Мотивация отдела продаж.xlsx')
    }
    
    if (fs.existsSync(filePath)) {
      const wb = XLSX.readFile(filePath)
      const settingsSheet = wb.Sheets['Настройки']
      if (settingsSheet) {
        const data = XLSX.utils.sheet_to_json(settingsSheet, { header: 1 }) as any[][]
        const rowIdx = 41 + currentMonth // Строка 43 - январь (индекс 42), Строка 48 - июнь (индекс 47)
        const row = data[rowIdx]
        if (row) {
          // Столбец C (индекс 2): Конверсия
          const excelConversion = Number(row[2])
          if (!isNaN(excelConversion) && excelConversion > 0) {
            targetConversion = excelConversion < 1 ? excelConversion * 100 : excelConversion
          }
          // Столбец D (индекс 3): Ср. чек ковров
          const excelAvgCheck = Number(row[3])
          if (!isNaN(excelAvgCheck) && excelAvgCheck > 0) {
            targetAvgCheck = excelAvgCheck
          }
        }
      }
    }
  } catch (err) {
    console.error('Ошибка при разборе нормативов KPI из Excel:', err)
  }

  return {
    rates,
    repeatShare,
    jackpot,
    plans,
    managerName,
    targetAvgCheck,
    targetConversion
  }
}
