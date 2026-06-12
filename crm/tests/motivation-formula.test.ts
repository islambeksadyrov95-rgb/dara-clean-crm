import { describe, it, expect } from 'vitest'
import {
  calculateGrade,
  computeBonus,
  type BonusInput,
} from '@/lib/motivation-formula'

const RATES = {
  carpets: 0.01,
  furniture: 0.015,
  curtains: 0.015,
  repeat: 0.03,
  dryClean: 0.005,
  blankets: 0.015,
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

describe('calculateGrade', () => {
  it('returns 0 below 70% achievement', () => {
    expect(calculateGrade(0)).toBe(0)
    expect(calculateGrade(0.69)).toBe(0)
  })

  it('returns 0.5 at exactly 70%', () => {
    expect(calculateGrade(0.7)).toBeCloseTo(0.5, 5)
  })

  it('returns 1.0 at exactly 85%', () => {
    expect(calculateGrade(0.85)).toBeCloseTo(1.0, 5)
  })

  it('caps at 1.5 for 100%+ achievement', () => {
    expect(calculateGrade(1.0)).toBe(1.5)
    expect(calculateGrade(2.5)).toBe(1.5)
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
    // carpets 100% → grade 1.5, rate 0.01*1.5=0.015, 500000*0.015 = 7500
    expect(res.categories.carpets.bonus).toBe(7500)
  })

  it('awards jackpot only when carpets, furniture and curtains all reach 100%', () => {
    const earned = computeBonus(
      makeInput({ revenue: { carpets: 500000, furniture: 400000, curtains: 300000, repeat: 0, dryClean: 0, blankets: 0 } })
    )
    expect(earned.isJackpotEarned).toBe(true)
    expect(earned.jackpotAmount).toBe(50000)
    expect(earned.totalPayout).toBe(earned.categoriesBonus + 50000)
  })

  it('does NOT award jackpot when one core category is below 100%', () => {
    const notEarned = computeBonus(
      makeInput({ revenue: { carpets: 500000, furniture: 400000, curtains: 200000, repeat: 0, dryClean: 0, blankets: 0 } })
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
