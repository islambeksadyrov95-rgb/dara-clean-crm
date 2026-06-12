import { describe, it, expect } from 'vitest'
import {
  calculateGrade,
  computeBonus,
  computeFullPayout,
  type BonusInput,
  type PayoutExtras,
} from '@/lib/motivation-formula'

// Эталонные ставки из формул Excel (лист «Настройки»).
const RATES = {
  carpets: 0.015,
  furniture: 0.03,
  curtains: 0.03,
  repeat: 0.03,
  dryClean: 0.005,
  blankets: 0.03,
}

const PLANS = {
  carpets: 500000,
  furniture: 400000,
  curtains: 300000,
  repeat: 360000,
  dryClean: 0,
  blankets: 0,
}

function makeInput(overrides?: Partial<BonusInput>): BonusInput {
  return {
    revenue: { carpets: 0, furniture: 0, curtains: 0, repeat: 0, dryClean: 0, blankets: 0 },
    plans: PLANS,
    rates: RATES,
    jackpot: 50000,
    ...overrides,
  }
}

describe('calculateGrade (шкала Excel)', () => {
  it('returns 0 below 70% achievement', () => {
    expect(calculateGrade(0)).toBe(0)
    expect(calculateGrade(0.69)).toBe(0)
  })

  it('равен проценту выполнения линейно на отрезке 70%..100%', () => {
    expect(calculateGrade(0.7)).toBeCloseTo(0.7, 5)
    expect(calculateGrade(0.85)).toBeCloseTo(0.85, 5)
    expect(calculateGrade(1.0)).toBeCloseTo(1.0, 5)
  })

  it('скачком становится 1.2 при превышении 100%', () => {
    expect(calculateGrade(1.0001)).toBe(1.2)
    expect(calculateGrade(1.2)).toBe(1.2)
    expect(calculateGrade(2.5)).toBe(1.2)
  })

  it('treats non-finite achievement as 0 (defensive guard)', () => {
    expect(calculateGrade(Number.NaN)).toBe(0)
    expect(calculateGrade(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('computeBonus', () => {
  it('produces integer money values (Math.round)', () => {
    const res = computeBonus(makeInput({ revenue: { carpets: 500000, furniture: 0, curtains: 0, repeat: 0, dryClean: 0, blankets: 0 } }))
    expect(Number.isInteger(res.categories.carpets.bonus)).toBe(true)
    expect(Number.isInteger(res.totalPayout)).toBe(true)
    // carpets 100% → grade 1.0, rate 0.015*1.0=0.015, 500000*0.015 = 7500
    expect(res.categories.carpets.bonus).toBe(7500)
  })

  it('применяет скачок 1.2 при выручке выше плана (>100%)', () => {
    // carpets 600000 / план 500000 = 120% → grade 1.2, эфф.ставка 0.015*1.2=0.018
    const res = computeBonus(makeInput({ revenue: { carpets: 600000, furniture: 0, curtains: 0, repeat: 0, dryClean: 0, blankets: 0 } }))
    expect(res.categories.carpets.grade).toBe(1.2)
    expect(res.categories.carpets.bonus).toBe(Math.round(600000 * 0.015 * 1.2)) // 10800
    expect(res.categories.carpets.bonus).toBe(10800)
  })

  it('начисляет джекпот при 100%+ по 4 категориям (ковры, мебель, шторы, повторные)', () => {
    const earned = computeBonus(
      makeInput({ revenue: { carpets: 500000, furniture: 400000, curtains: 300000, repeat: 360000, dryClean: 0, blankets: 0 } })
    )
    expect(earned.isJackpotEarned).toBe(true)
    expect(earned.jackpotAmount).toBe(50000)
    expect(earned.totalPayout).toBe(earned.categoriesBonus + 50000)
  })

  it('НЕ начисляет джекпот без выполнения повторных (4-я категория)', () => {
    const notEarned = computeBonus(
      makeInput({ revenue: { carpets: 500000, furniture: 400000, curtains: 300000, repeat: 0, dryClean: 0, blankets: 0 } })
    )
    expect(notEarned.isJackpotEarned).toBe(false)
    expect(notEarned.jackpotAmount).toBe(0)
  })

  it('НЕ начисляет джекпот, когда одна из основных категорий ниже 100%', () => {
    const notEarned = computeBonus(
      makeInput({ revenue: { carpets: 500000, furniture: 400000, curtains: 200000, repeat: 360000, dryClean: 0, blankets: 0 } })
    )
    expect(notEarned.isJackpotEarned).toBe(false)
    expect(notEarned.jackpotAmount).toBe(0)
  })

  it('computes percentOfRevenue and totalRevenue', () => {
    const res = computeBonus(
      makeInput({ revenue: { carpets: 500000, furniture: 0, curtains: 0, repeat: 0, dryClean: 0, blankets: 0 } })
    )
    expect(res.totalRevenue).toBe(500000)
    expect(res.percentOfRevenue).toBeCloseTo((7500 / 500000) * 100, 5)
  })

  it('gracefully returns zero payout and percent when revenue is empty', () => {
    const res = computeBonus(makeInput())
    expect(res.totalRevenue).toBe(0)
    expect(res.totalPayout).toBe(0)
    expect(res.percentOfRevenue).toBe(0)
  })

  it('reports avgAchievement based only on categories with a plan > 0', () => {
    const res = computeBonus(
      makeInput({ revenue: { carpets: 250000, furniture: 400000, curtains: 300000, repeat: 360000, dryClean: 0, blankets: 0 } })
    )
    // planned: carpets(50%), furniture(100%), curtains(100%), repeat(100%) → avg = 87.5%
    expect(res.avgAchievement).toBeCloseTo(87.5, 5)
  })
})

describe('контрольная сверка (план Елены, июнь, факт = план 100%)', () => {
  // Эталон из формул Excel. План Елены, выручка = план (выполнение ровно 100%, без превышения).
  const ELENA_PLANS = {
    carpets: 7582410,
    furniture: 614790,
    curtains: 614790,
    repeat: 1895603,
    dryClean: 341208,
    blankets: 409860,
  }
  const ELENA_REVENUE = { ...ELENA_PLANS }

  const res = computeBonus({
    revenue: ELENA_REVENUE,
    plans: ELENA_PLANS,
    rates: RATES,
    jackpot: 50000,
  })

  it('бонусы по категориям совпадают с эталоном Excel', () => {
    expect(res.categories.carpets.bonus).toBe(113736)
    expect(res.categories.furniture.bonus).toBe(18444)
    expect(res.categories.curtains.bonus).toBe(18444)
    expect(res.categories.repeat.bonus).toBe(56868)
    expect(res.categories.dryClean.bonus).toBe(1706)
    expect(res.categories.blankets.bonus).toBe(12296)
  })

  it('сумма бонусов по категориям = 221 494 ₸', () => {
    expect(res.categoriesBonus).toBe(221494)
  })

  it('джекпот заработан (все 4 категории на 100%) = 50 000 ₸', () => {
    expect(res.isJackpotEarned).toBe(true)
    expect(res.jackpotAmount).toBe(50000)
  })

  it('полный итог с окладом = оклад + категории + джекпот + KPI', () => {
    const extras: PayoutExtras = {
      salary: 150000,
      kpiBonus: 25000,
      kpiAvgCheckTarget: 19500,
      kpiCallConversionTarget: 0.25,
      // KPI не выполнены — проверяем именно оклад + премии + джекпот
      actualAvgCheck: 0,
      actualCallConversion: 0,
    }
    const full = computeFullPayout(
      { revenue: ELENA_REVENUE, plans: ELENA_PLANS, rates: RATES, jackpot: 50000 },
      extras
    )
    expect(full.kpi.total).toBe(0)
    // 150000 + 221494 + 50000 = 421494
    expect(full.grandTotal).toBe(421494)
  })
})

describe('computeFullPayout — KPI-бонусы', () => {
  const baseExtras: PayoutExtras = {
    salary: 150000,
    kpiBonus: 25000,
    kpiAvgCheckTarget: 19500,
    kpiCallConversionTarget: 0.25,
    actualAvgCheck: 0,
    actualCallConversion: 0,
  }

  it('начисляет оба KPI-бонуса при достижении нормативов', () => {
    const full = computeFullPayout(makeInput(), {
      ...baseExtras,
      actualAvgCheck: 20000,
      actualCallConversion: 0.3,
    })
    expect(full.kpi.isAvgCheckMet).toBe(true)
    expect(full.kpi.isCallConversionMet).toBe(true)
    expect(full.kpi.total).toBe(50000)
    // пустая выручка → premии 0, итог = оклад + KPI
    expect(full.grandTotal).toBe(150000 + 0 + 50000)
  })

  it('не начисляет KPI-бонусы ниже нормативов', () => {
    const full = computeFullPayout(makeInput(), {
      ...baseExtras,
      actualAvgCheck: 19499,
      actualCallConversion: 0.2499,
    })
    expect(full.kpi.total).toBe(0)
    expect(full.grandTotal).toBe(150000)
  })

  it('начисляет только один KPI-бонус (средний чек выполнен, конверсия — нет)', () => {
    const full = computeFullPayout(makeInput(), {
      ...baseExtras,
      actualAvgCheck: 19500,
      actualCallConversion: 0.1,
    })
    expect(full.kpi.avgCheckBonus).toBe(25000)
    expect(full.kpi.callConversionBonus).toBe(0)
    expect(full.kpi.total).toBe(25000)
  })
})
