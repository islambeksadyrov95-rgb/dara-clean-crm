import * as XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'

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

// Сопоставление email менеджера с его именем в Excel
export function getManagerNameByEmail(email: string): 'Елена' | 'Самал' | 'Рауза' {
  const lowEmail = email.toLowerCase()
  if (lowEmail.includes('elena') || lowEmail.includes('елена')) return 'Елена'
  if (lowEmail.includes('samal') || lowEmail.includes('самал')) return 'Самал'
  if (lowEmail.includes('rauza') || lowEmail.includes('рауза')) return 'Рауза'
  // По умолчанию возвращаем Елена
  return 'Елена'
}

export function getMotivationConfig(managerEmail: string): MotivationConfig {
  const managerName = getManagerNameByEmail(managerEmail)
  
  try {
    const filePath = path.join(process.cwd(), 'Мотивация отдела продаж.xlsx')
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_CONFIG, managerName }
    }

    const wb = XLSX.readFile(filePath)
    
    // 1. Лист "Настройки"
    const settingsSheet = wb.Sheets['Настройки']
    let carpetsRate = DEFAULT_CONFIG.rates.carpets
    let furnitureRate = DEFAULT_CONFIG.rates.furniture
    let curtainsRate = DEFAULT_CONFIG.rates.curtains
    let repeatRate = DEFAULT_CONFIG.rates.repeat
    let jackpot = DEFAULT_CONFIG.jackpot
    let repeatShare = DEFAULT_CONFIG.repeatShare

    if (settingsSheet) {
      const getVal = (cellRef: string, def: number) => {
        const cell = settingsSheet[cellRef]
        if (cell && cell.v !== undefined) {
          const val = Number(cell.v)
          return isNaN(val) ? def : val
        }
        return def
      }

      // Базовые % от выручки
      carpetsRate = getVal('B10', carpetsRate)
      furnitureRate = getVal('B11', furnitureRate)
      curtainsRate = getVal('B12', curtainsRate)
      repeatRate = getVal('B13', repeatRate)
      jackpot = getVal('B21', jackpot)
      repeatShare = getVal('B35', repeatShare)
    }

    // 2. Лист "Планы по категориям"
    const plansSheet = wb.Sheets['Планы по категориям']
    const plans = { ...DEFAULT_CONFIG.plans }

    if (plansSheet) {
      const currentMonth = new Date().getMonth() + 1 // 1 - 12
      const rowIdx = 5 + currentMonth // Строка 6 - январь, 7 - февраль...

      // Определяем столбцы на основе имени менеджера
      // Ковры: Елена=C, Самал=D, Рауза=E
      // Мебель: Елена=G, Самал=H, Рауза=I
      // Шторы: Елена=K, Самал=L, Рауза=M
      // Повторные: Елена=O, Самал=P, Рауза=Q
      let carpetsCol = 'C'
      let furnitureCol = 'G'
      let curtainsCol = 'K'
      let repeatCol = 'O'

      if (managerName === 'Самал') {
        carpetsCol = 'D'
        furnitureCol = 'H'
        curtainsCol = 'L'
        repeatCol = 'P'
      } else if (managerName === 'Рауза') {
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

    return {
      rates: {
        carpets: carpetsRate,
        furniture: furnitureRate,
        curtains: curtainsRate,
        repeat: repeatRate,
      },
      repeatShare,
      jackpot,
      plans,
      managerName
    }
  } catch (e) {
    console.error('Ошибка при разборе Excel-файла мотивации:', e)
    return { ...DEFAULT_CONFIG, managerName }
  }
}
