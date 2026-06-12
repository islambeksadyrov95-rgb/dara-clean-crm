// Единая формула расчёта премии менеджера.
// Используется и в режиме менеджера («Моя мотивация»), и в режиме админа («Ведомость бонусов»).
// НЕ дублировать расчёт в компонентах — импортировать отсюда.

export interface CategoryRevenue {
  carpets: number
  furniture: number
  curtains: number
  repeat: number
  dryClean: number
  blankets: number
}

export interface MotivationRates {
  carpets: number
  furniture: number
  curtains: number
  repeat: number
  dryClean: number
  blankets: number
}

export interface MotivationPlans {
  carpets: number
  furniture: number
  curtains: number
  repeat: number
  dryClean: number
  blankets: number
}

export interface BonusInput {
  revenue: CategoryRevenue
  plans: MotivationPlans
  rates: MotivationRates
  jackpot: number
}

export interface CategoryBonus {
  achievement: number
  grade: number
  effectiveRate: number
  bonus: number
}

export interface BonusResult {
  categories: {
    carpets: CategoryBonus
    furniture: CategoryBonus
    curtains: CategoryBonus
    repeat: CategoryBonus
    dryClean: CategoryBonus
    blankets: CategoryBonus
  }
  /** Сумма бонусов по всем категориям (без джекпота), integer */
  categoriesBonus: number
  /** Джекпот заработан: 3 основные категории (Ковры, Мебель, Шторы) выполнены на 100%+ */
  isJackpotEarned: boolean
  jackpotAmount: number
  /** Итого к выплате = categoriesBonus + jackpotAmount, integer */
  totalPayout: number
  /** Общая выручка по 6 категориям */
  totalRevenue: number
  /** Итого % ЗП от выручки (totalPayout / totalRevenue * 100) */
  percentOfRevenue: number
  /** Средний % выполнения планов по категориям, у которых план > 0 */
  avgAchievement: number
}

type CategoryKey = keyof CategoryRevenue

const CATEGORY_KEYS: readonly CategoryKey[] = [
  'carpets',
  'furniture',
  'curtains',
  'repeat',
  'dryClean',
  'blankets',
]

/**
 * Грейд (коэффициент) по проценту выполнения плана.
 * < 70% → 0; 70–85% → 0.5..1.0; 85–100% → 1.0..1.5; ≥ 100% → 1.5.
 */
export function calculateGrade(achievement: number): number {
  if (!Number.isFinite(achievement) || achievement < 0.7) return 0
  if (achievement < 0.85) return 0.5 + ((achievement - 0.7) / 0.15) * 0.5
  if (achievement < 1.0) return 1.0 + ((achievement - 0.85) / 0.15) * 0.5
  return 1.5
}

function computeCategory(
  revenue: number,
  plan: number,
  rate: number
): CategoryBonus {
  const achievement = plan > 0 ? revenue / plan : 0
  const grade = calculateGrade(achievement)
  const effectiveRate = rate * grade
  const bonus = Math.round(revenue * effectiveRate)
  return { achievement, grade, effectiveRate, bonus }
}

/**
 * Единый расчёт премии менеджера по фактической выручке и планам.
 * Деньги — integer, Math.round после умножений.
 */
export function computeBonus(input: BonusInput): BonusResult {
  const { revenue, plans, rates, jackpot } = input

  const categories = {
    carpets: computeCategory(revenue.carpets, plans.carpets, rates.carpets),
    furniture: computeCategory(revenue.furniture, plans.furniture, rates.furniture),
    curtains: computeCategory(revenue.curtains, plans.curtains, rates.curtains),
    repeat: computeCategory(revenue.repeat, plans.repeat, rates.repeat),
    dryClean: computeCategory(revenue.dryClean, plans.dryClean, rates.dryClean),
    blankets: computeCategory(revenue.blankets, plans.blankets, rates.blankets),
  }

  const categoriesBonus = CATEGORY_KEYS.reduce(
    (sum, key) => sum + categories[key].bonus,
    0
  )

  // Джекпот: выполнение планов 3 основных категорий (Ковры, Мебель, Шторы) на 100%+
  const isJackpotEarned =
    categories.carpets.achievement >= 1.0 &&
    categories.furniture.achievement >= 1.0 &&
    categories.curtains.achievement >= 1.0
  const jackpotAmount = isJackpotEarned ? Math.round(jackpot) : 0

  const totalPayout = categoriesBonus + jackpotAmount

  const totalRevenue = CATEGORY_KEYS.reduce((sum, key) => sum + revenue[key], 0)
  const percentOfRevenue = totalRevenue > 0 ? (totalPayout / totalRevenue) * 100 : 0

  // Средний % выполнения по категориям, у которых задан план (для ведомости без денег)
  const planned = CATEGORY_KEYS.filter((key) => plans[key] > 0)
  const avgAchievement =
    planned.length > 0
      ? (planned.reduce((sum, key) => sum + categories[key].achievement, 0) /
          planned.length) *
        100
      : 0

  return {
    categories,
    categoriesBonus,
    isJackpotEarned,
    jackpotAmount,
    totalPayout,
    totalRevenue,
    percentOfRevenue,
    avgAchievement,
  }
}
