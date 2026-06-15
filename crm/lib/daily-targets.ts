/**
 * Pure date/plan helpers for the queue «План дня» widget.
 * No imports, no I/O, no `any` — safe to test without DB mocks.
 */

/**
 * Counts Mon–Fri working weekdays in a given month.
 * Returns at least 1 (floor) to prevent division-by-zero downstream.
 */
export function workingWeekdaysInMonth(year: number, month1to12: number): number {
  const daysInMonth = new Date(year, month1to12, 0).getDate()
  let count = 0
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month1to12 - 1, day).getDay()
    if (dow >= 1 && dow <= 5) count++
  }
  return Math.max(1, count)
}

export type DailyTargetsInput = {
  repeatPlanTenge: number
  avgCheck: number
  callsTarget: number
  workingDays: number
  managerCount: number
}

export type DailyTargetsResult = {
  revenuePerDay: number
  ordersPerDay: number
  callsPerDay: number
}

/**
 * Derives per-day targets from a monthly repeat plan and settings.
 * Guards against division-by-zero and absent plans.
 */
export function deriveDailyTargets(input: DailyTargetsInput): DailyTargetsResult {
  const days = Math.max(1, input.workingDays)
  const callsPerDay = input.callsTarget * Math.max(1, input.managerCount)

  if (input.repeatPlanTenge <= 0) {
    return { revenuePerDay: 0, ordersPerDay: 0, callsPerDay }
  }

  const revenuePerDay = Math.round(input.repeatPlanTenge / days)
  const ordersPerDay =
    input.avgCheck > 0 ? Math.max(1, Math.round(revenuePerDay / input.avgCheck)) : 0

  return { revenuePerDay, ordersPerDay, callsPerDay }
}
