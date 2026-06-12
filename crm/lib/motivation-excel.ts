import * as XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import { createClient } from '@/lib/supabase/server'

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
  /** Оклад за месяц, ₸ (Excel: 150 000) */
  salary: number
  /** Размер одного KPI-бонуса, ₸ (Excel: 25 000) */
  kpiBonus: number
  /** Норматив среднего чека для KPI-бонуса, ₸ (Excel: 19 500) */
  kpiAvgCheckTarget: number
  /** Норматив конверсии обзвона базы для KPI-бонуса (доля 0..1, Excel: 0.25) */
  kpiCallConversionTarget: number
}

/** Эталонные дефолты из формул Excel (лист «Настройки»). Экспортируется для тестов и фолбэка. */
export const DEFAULT_MOTIVATION_CONFIG: Omit<MotivationConfig, 'managerName'> = {
  // Эталонные базовые ставки из формул Excel.
  rates: {
    carpets: 0.015, // 1.5%
    furniture: 0.03, // 3.0%
    curtains: 0.03, // 3.0%
    repeat: 0.03, // 3.0%
    dryClean: 0.005, // 0.5% (самовывоз / dry clean)
    blankets: 0.03, // 3.0% (пледы / одеяла)
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
  targetConversion: 12,
  salary: 150000,
  kpiBonus: 25000,
  kpiAvgCheckTarget: 19500,
  kpiCallConversionTarget: 0.25,
}

const DEFAULT_CONFIG = DEFAULT_MOTIVATION_CONFIG

export async function getMotivationConfig(
  managerEmail: string,
  month?: number,
  year?: number
): Promise<MotivationConfig> {
  const supabase = await createClient()
  // 1. Находим пользователя по email через public.profiles
  let managerId = ''
  let managerName = managerEmail.split('@')[0]
  managerName = managerName.charAt(0).toUpperCase() + managerName.slice(1)
  
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('email', managerEmail.toLowerCase())
      .maybeSingle()
    if (profile) {
      managerId = profile.id
      managerName = profile.name || managerName
    }
  } catch (err) {
    console.error('Ошибка получения пользователя из profiles в getMotivationConfig:', err)
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
  let salary = DEFAULT_CONFIG.salary
  let kpiBonus = DEFAULT_CONFIG.kpiBonus
  let kpiAvgCheckTarget = DEFAULT_CONFIG.kpiAvgCheckTarget
  let kpiCallConversionTarget = DEFAULT_CONFIG.kpiCallConversionTarget

  // 2. Сначала загружаем общие настройки мотивации (ставки, джекпот) из crm_settings
  try {
    const { data: dbData } = await supabase
      .from('crm_settings')
      .select('value')
      .eq('key', 'motivation_config')
      .single()

    if (dbData && dbData.value && typeof dbData.value === 'object' && !Array.isArray(dbData.value)) {
      const dbConfig = dbData.value as Record<string, unknown>
      const dbRates =
        dbConfig.rates && typeof dbConfig.rates === 'object'
          ? (dbConfig.rates as Record<string, unknown>)
          : {}
      const numOr = (value: unknown, fallback: number): number =>
        typeof value === 'number' && Number.isFinite(value) ? value : fallback

      rates = {
        carpets: numOr(dbRates.carpets, DEFAULT_CONFIG.rates.carpets),
        furniture: numOr(dbRates.furniture, DEFAULT_CONFIG.rates.furniture),
        curtains: numOr(dbRates.curtains, DEFAULT_CONFIG.rates.curtains),
        repeat: numOr(dbRates.repeat, DEFAULT_CONFIG.rates.repeat),
        dryClean: numOr(dbRates.dryClean, DEFAULT_CONFIG.rates.dryClean),
        blankets: numOr(dbRates.blankets, DEFAULT_CONFIG.rates.blankets),
      }
      repeatShare = numOr(dbConfig.repeatShare, DEFAULT_CONFIG.repeatShare)
      jackpot = numOr(dbConfig.jackpot, DEFAULT_CONFIG.jackpot)
      salary = numOr(dbConfig.salary, DEFAULT_CONFIG.salary)
      kpiBonus = numOr(dbConfig.kpiBonus, DEFAULT_CONFIG.kpiBonus)
      kpiAvgCheckTarget = numOr(dbConfig.kpiAvgCheckTarget, DEFAULT_CONFIG.kpiAvgCheckTarget)
      kpiCallConversionTarget = numOr(
        dbConfig.kpiCallConversionTarget,
        DEFAULT_CONFIG.kpiCallConversionTarget
      )
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
    targetConversion,
    salary,
    kpiBonus,
    kpiAvgCheckTarget,
    kpiCallConversionTarget,
  }
}
