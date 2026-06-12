// Единая формула расчёта премии менеджера.
// Используется и в режиме менеджера («Моя мотивация»), и в режиме админа («Ведомость бонусов»).
// НЕ дублировать расчёт в компонентах — импортировать отсюда.
//
// Источник правды — Excel «Мотивация отдела продаж», лист «Настройки».
// Шкала коэффициента и условие джекпота извлечены из формул ячеек.

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

/** Параметры оклада и KPI-бонусов для полного расчёта «к выплате». */
export interface PayoutExtras {
  /** Оклад за месяц, ₸ (integer) */
  salary: number
  /** Размер одного KPI-бонуса, ₸ (integer) */
  kpiBonus: number
  /** Норматив среднего чека (₸), при достижении которого начисляется KPI-бонус */
  kpiAvgCheckTarget: number
  /** Норматив конверсии обзвона базы (доля 0..1), при достижении — KPI-бонус */
  kpiCallConversionTarget: number
  /** Фактический средний чек за месяц, ₸ */
  actualAvgCheck: number
  /** Фактическая конверсия обзвона базы (доля 0..1) = заказы / звонки */
  actualCallConversion: number
}

export interface CategoryBonus {
  achievement: number
  grade: number
  effectiveRate: number
  bonus: number
}

export interface KpiBonusResult {
  /** Средний чек ≥ норматива */
  isAvgCheckMet: boolean
  /** Конверсия обзвона базы ≥ норматива */
  isCallConversionMet: boolean
  avgCheckBonus: number
  callConversionBonus: number
  /** Сумма заработанных KPI-бонусов, integer */
  total: number
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
  /** Джекпот заработан: 4 категории (Ковры, Мебель, Шторы, Повторные) выполнены на 100%+ */
  isJackpotEarned: boolean
  jackpotAmount: number
  /** Итого премии = categoriesBonus + jackpotAmount, integer (БЕЗ оклада и KPI) */
  totalPayout: number
  /** Общая выручка по 6 категориям */
  totalRevenue: number
  /** Итого % ЗП от выручки (totalPayout / totalRevenue * 100) */
  percentOfRevenue: number
  /** Средний % выполнения планов по категориям, у которых план > 0 */
  avgAchievement: number
}

export interface FullPayoutResult extends BonusResult {
  salary: number
  kpi: KpiBonusResult
  /** Полное «к выплате» = оклад + бонусы категорий + джекпот + KPI-бонусы, integer */
  grandTotal: number
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

const GRADE_OVERPERFORM = 1.2

/**
 * Коэффициент (грейд) по проценту выполнения плана — шкала Excel (лист «Настройки»).
 * a < 0.7 → 0; 0.7 ≤ a ≤ 1.0 → коэффициент = a (линейно: 0.7→0.7, 0.85→0.85, 1.0→1.0);
 * a > 1.0 → 1.2 (скачком, не линейно).
 */
export function calculateGrade(achievement: number): number {
  if (!Number.isFinite(achievement) || achievement < 0.7) return 0
  if (achievement <= 1.0) return achievement
  return GRADE_OVERPERFORM
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

  // Джекпот (Excel): AND(ковры≥100%, мебель≥100%, шторы≥100%, повторные≥100%).
  const isJackpotEarned =
    categories.carpets.achievement >= 1.0 &&
    categories.furniture.achievement >= 1.0 &&
    categories.curtains.achievement >= 1.0 &&
    categories.repeat.achievement >= 1.0
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

/**
 * KPI-бонусы по нормативам Excel: средний чек и конверсия обзвона базы.
 * Третий Excel-KPI «конверсия обращение→заказ» CRM не меряет — здесь не учитывается.
 */
export function computeKpiBonuses(extras: PayoutExtras): KpiBonusResult {
  const isAvgCheckMet = extras.actualAvgCheck >= extras.kpiAvgCheckTarget
  const isCallConversionMet =
    extras.actualCallConversion >= extras.kpiCallConversionTarget
  const avgCheckBonus = isAvgCheckMet ? Math.round(extras.kpiBonus) : 0
  const callConversionBonus = isCallConversionMet ? Math.round(extras.kpiBonus) : 0
  return {
    isAvgCheckMet,
    isCallConversionMet,
    avgCheckBonus,
    callConversionBonus,
    total: avgCheckBonus + callConversionBonus,
  }
}

/**
 * Полный расчёт «к выплате» = оклад + бонусы категорий + джекпот + KPI-бонусы.
 * Чистая функция, без I/O. Внутри переиспользует computeBonus и computeKpiBonuses.
 */
export function computeFullPayout(
  input: BonusInput,
  extras: PayoutExtras
): FullPayoutResult {
  const base = computeBonus(input)
  const kpi = computeKpiBonuses(extras)
  const salary = Math.round(extras.salary)
  const grandTotal = salary + base.totalPayout + kpi.total
  return { ...base, salary, kpi, grandTotal }
}
