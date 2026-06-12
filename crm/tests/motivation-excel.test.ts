import { describe, it, expect } from 'vitest'
import { DEFAULT_MOTIVATION_CONFIG } from '@/lib/motivation-excel'

// Эталон из формул Excel (лист «Настройки»). Эти значения — контракт расчёта премии.
describe('DEFAULT_MOTIVATION_CONFIG (эталон Excel)', () => {
  it('базовые ставки соответствуют формулам Excel', () => {
    expect(DEFAULT_MOTIVATION_CONFIG.rates).toEqual({
      carpets: 0.015,
      furniture: 0.03,
      curtains: 0.03,
      repeat: 0.03,
      dryClean: 0.005,
      blankets: 0.03,
    })
  })

  it('оклад и KPI-нормативы соответствуют Excel', () => {
    expect(DEFAULT_MOTIVATION_CONFIG.salary).toBe(150000)
    expect(DEFAULT_MOTIVATION_CONFIG.kpiBonus).toBe(25000)
    expect(DEFAULT_MOTIVATION_CONFIG.kpiAvgCheckTarget).toBe(19500)
    expect(DEFAULT_MOTIVATION_CONFIG.kpiCallConversionTarget).toBe(0.25)
  })

  it('джекпот — 50 000 ₸', () => {
    expect(DEFAULT_MOTIVATION_CONFIG.jackpot).toBe(50000)
  })
})
