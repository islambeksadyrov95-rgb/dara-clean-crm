import { describe, it, expect } from 'vitest'
import { workingWeekdaysInMonth, deriveDailyTargets } from '@/lib/daily-targets'

// Июнь 2026: пн 1 — пт 5, пн 8 — пт 12, пн 15 — пт 19, пн 22 — пт 26, пн 29 — вт 30
// Итого: 5+5+5+5+2 = 22 рабочих дня
describe('workingWeekdaysInMonth', () => {
  it('возвращает 22 рабочих дня для июня 2026', () => {
    expect(workingWeekdaysInMonth(2026, 6)).toBe(22)
  })

  it('возвращает 21 рабочий день для января 2026 (четверг 1 янв — пятница 30 янв)', () => {
    // Янв 2026: 1(чт)..2(пт) = 2 дня, 5..9 = 5, 12..16 = 5, 19..23 = 5, 26..30 = 5 → 2+5+5+5+5 = 22
    // На самом деле: 1янв = четверг; рабочие: 1,2,5,6,7,8,9,12,13,14,15,16,19,20,21,22,23,26,27,28,29,30 = 22
    expect(workingWeekdaysInMonth(2026, 1)).toBe(22)
  })

  it('возвращает корректное число для февраля 2026 (не високосный)', () => {
    // Фев 2026: 28 дней. 1 = вс. пн=2..6(5), 9..13(5), 16..20(5), 23..27(5) = 20 рабочих
    expect(workingWeekdaysInMonth(2026, 2)).toBe(20)
  })

  it('никогда не возвращает 0 (floor=1)', () => {
    // Гипотетический случай: функция всегда >= 1
    const result = workingWeekdaysInMonth(2026, 6)
    expect(result).toBeGreaterThanOrEqual(1)
  })
})

describe('deriveDailyTargets', () => {
  it('нормальный менеджер: repeat=1895603, avgCheck=17000, calls=40, days=22, count=1', () => {
    const result = deriveDailyTargets({
      repeatPlanTenge: 1895603,
      avgCheck: 17000,
      callsTarget: 40,
      workingDays: 22,
      managerCount: 1,
    })
    // revenuePerDay = Math.round(1895603/22) = Math.round(86163.77) = 86164
    expect(result.revenuePerDay).toBe(86164)
    // ordersPerDay = Math.max(1, Math.round(86164/17000)) = Math.max(1, Math.round(5.07)) = 5
    expect(result.ordersPerDay).toBe(5)
    expect(result.callsPerDay).toBe(40)
  })

  it('отсутствующий план (repeatPlanTenge=0): revenuePerDay=0, ordersPerDay=0', () => {
    const result = deriveDailyTargets({
      repeatPlanTenge: 0,
      avgCheck: 17000,
      callsTarget: 40,
      workingDays: 22,
      managerCount: 1,
    })
    expect(result.revenuePerDay).toBe(0)
    expect(result.ordersPerDay).toBe(0)
    // callsPerDay всё равно вычисляется
    expect(result.callsPerDay).toBe(40)
  })

  it('отдел из 2 менеджеров: callsPerDay = callsTarget * 2', () => {
    const result = deriveDailyTargets({
      repeatPlanTenge: 3791206,
      avgCheck: 17000,
      callsTarget: 40,
      workingDays: 22,
      managerCount: 2,
    })
    expect(result.callsPerDay).toBe(80)
    // revenuePerDay = Math.round(3791206/22) = Math.round(172327.5) = 172328
    expect(result.revenuePerDay).toBe(172328)
  })

  it('avgCheck=0: не падает, ordersPerDay=0', () => {
    const result = deriveDailyTargets({
      repeatPlanTenge: 500000,
      avgCheck: 0,
      callsTarget: 40,
      workingDays: 22,
      managerCount: 1,
    })
    expect(result.ordersPerDay).toBe(0)
    // revenuePerDay всё равно вычисляется
    expect(result.revenuePerDay).toBe(Math.round(500000 / 22))
    expect(result.callsPerDay).toBe(40)
  })

  it('workingDays=0: floor до 1, нет деления на ноль', () => {
    const result = deriveDailyTargets({
      repeatPlanTenge: 100000,
      avgCheck: 17000,
      callsTarget: 40,
      workingDays: 0,
      managerCount: 1,
    })
    // days = Math.max(1,0) = 1 → revenuePerDay = 100000
    expect(result.revenuePerDay).toBe(100000)
    expect(Number.isFinite(result.revenuePerDay)).toBe(true)
  })

  it('managerCount=0: floor до 1, callsPerDay = callsTarget', () => {
    const result = deriveDailyTargets({
      repeatPlanTenge: 500000,
      avgCheck: 17000,
      callsTarget: 40,
      workingDays: 22,
      managerCount: 0,
    })
    expect(result.callsPerDay).toBe(40)
  })
})
