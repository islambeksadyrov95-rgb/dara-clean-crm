;(function (global) {
  'use strict'

  const STORAGE_KEY = 'dc-finplan'

  const SEASONAL_COEF = (function () {
    // Из FACT_2025_MONTHLY.revenue — нормированные коэффициенты сезонности
    const rev = [4066009, 5073529, 5936965, 7752958, 9441972, 11231195,
                 11139195, 7512538, 13387344, 8950309, 10010031, 15103879]
    const total = rev.reduce((s, v) => s + v, 0)
    return rev.map(v => v / total * 12)  // * 12 чтобы среднее = 1.0
  })()

  const DEFAULT_STATE = {
    revenueGrowthPct:    25,
    quarterCoef:         [1, 1, 1, 1],  // квартальные множители Q1-Q4
    inflationPct:         8,    // средняя инфляция по РК
    withdrawalLimit:    300000,
    targetMarginPct:     15,
    costOpt: { production: 0, logistics: 0, marketing: 10, sales: 0, taxes: 0, overhead: 0 },
    // Кассовый разрыв: долг на конец 2025 и помесячное погашение
    cashGapDebt: 5_431_123,       // начальный долг (положительное число)
    cashGapMonthlyPayment: 0,     // ежемесячный платёж (начиная со след. месяца)
    cashGapStartMonth: 4,         // месяц начала погашения (0=янв, 4=май)
    scenarios: [
      { name: 'Пессимистичный', revenueGrowth: 10,  costOpt: 0,  withdrawalLimit: 500000 },
      { name: 'Базовый',        revenueGrowth: 25,  costOpt: 10, withdrawalLimit: 300000 },
      { name: 'Оптимистичный',  revenueGrowth: 40,  costOpt: 15, withdrawalLimit: 200000 }
    ],
    growthPlan: {
      2026: { revenueGrowth: 25, costOpt: 10, marketingBudget: 15000000 },
      2027: { revenueGrowth: 20, costOpt:  5, marketingBudget: 18000000 },
      2028: { revenueGrowth: 15, costOpt:  5, marketingBudget: 20000000 }
    }
  }

  let _state = DEFAULT_STATE
  const _listeners = []

  function load () {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved) _state = Object.assign({}, DEFAULT_STATE, saved)
    } catch (e) { /**/ }
    return _state
  }

  function save () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)) } catch (e) { /**/ }
  }

  function getState () { return _state }

  function setState (patch) {
    _state = Object.assign({}, _state, patch)
    save()
    _listeners.forEach(cb => { try { cb(_state) } catch (e) { /**/ } })
  }

  function onChange (cb) {
    _listeners.push(cb)
    return () => {
      const idx = _listeners.indexOf(cb)
      if (idx >= 0) _listeners.splice(idx, 1)
    }
  }

  /**
   * Вычислить помесячный план выручки на год.
   * @param {number} factRevenue  — годовая выручка-факт (101M)
   * @param {number} growthPct    — процент роста (25 → 1.25)
   * @returns {number[]} 12 элементов
   */
  function computeMonthlyRevenue (factRevenue, growthPct) {
    const planTotal = factRevenue * (1 + growthPct / 100)
    return SEASONAL_COEF.map(c => Math.round(planTotal / 12 * c))
  }

  /**
   * Вычислить помесячный план выручки с квартальными множителями.
   * Формула: Факт_месяц_2025 × (1 + рост%) × Q_множитель × (1 + инфляция%)
   * @param {number[]} factMonthlyRevenue — помесячная выручка-факт 2025 (12 элементов)
   * @param {number} growthPct — базовый рост % (применяется к каждому месяцу)
   * @param {number[]} qCoef — квартальные множители [Q1, Q2, Q3, Q4] (по умолчанию [1,1,1,1])
   * @param {number} inflationPct — годовая инфляция %
   * @returns {number[]} 12 элементов
   */
  function computeMonthlyRevenueQ (factMonthlyRevenue, growthPct, qCoef, inflationPct) {
    const growthMul = 1 + (growthPct || 0) / 100
    // Инфляция к выручке НЕ применяется — 25% это целевой номинальный рост (решение собственника)
    return factMonthlyRevenue.map((fact, i) => {
      const q = Math.floor(i / 3)
      const coef = (qCoef && qCoef[q]) || 1
      return Math.round(fact * growthMul * coef)
    })
  }

  /**
   * Вычислить помесячные расходы с оптимизацией.
   * @param {Object} factBlockTotals — { production: N, ... }
   * @param {Object} costOptPct      — { production: 0, marketing: 10, ... }
   * @param {number} growthPct       — рост выручки → расходы растут чуть меньше
   * @param {number} [inflationPct]  — инфляция (% годовых), увеличивает все расходы
   * @returns {{ byMonth: [12], byBlock: {k:[12]}, totals: {k: N} }}
   */
  function computeMonthlyCosts (factBlockTotals, costOptPct, growthPct, inflationPct) {
    const BLOCK_KEYS = ['production', 'logistics', 'marketing', 'sales', 'taxes', 'overhead']
    // Формула: Факт × (1 + рост%) × (1 + инфляция%) × (1 - оптимизация%)
    // Инфляция на расходы применяется всегда — поставщики, ФОТ, ГСМ растут независимо от нас
    const growthFactor = 1 + (growthPct || 0) / 100
    const inflMul = 1 + (inflationPct || 0) / 100
    const totals = {}
    BLOCK_KEYS.forEach(k => {
      const opt = (costOptPct[k] || 0) / 100
      totals[k] = Math.round(factBlockTotals[k] * growthFactor * inflMul * (1 - opt))
    })

    const byBlock = {}
    BLOCK_KEYS.forEach(k => {
      byBlock[k] = SEASONAL_COEF.map(c => Math.round(totals[k] / 12 * c))
    })

    const byMonth = new Array(12).fill(0).map((_, i) =>
      BLOCK_KEYS.reduce((s, k) => s + byBlock[k][i], 0)
    )

    return { byMonth, byBlock, totals }
  }

  /**
   * Вычислить кумулятивный денежный поток по сценарию.
   * @param {{ revenue, totalCogs, withdrawals }} fact2025Totals
   * @param {{ revenueGrowth, costOpt, withdrawalLimit }} params
   * @returns {{ monthly: [12], cumulative: [12] }}
   */
  function computeScenario (fact2025Totals, params) {
    const FD = global.FinanceData
    const factBlocks = FD ? FD.BLOCK_META : null
    const factBlockTotals = {}
    const BLOCK_KEYS = ['production', 'logistics', 'marketing', 'sales', 'taxes', 'overhead']
    BLOCK_KEYS.forEach(k => {
      factBlockTotals[k] = factBlocks ? factBlocks[k].factTotal : fact2025Totals.totalCogs / 6
    })

    const revenues = computeMonthlyRevenue(fact2025Totals.revenue, params.revenueGrowth)
    const costOptPct = {}
    BLOCK_KEYS.forEach(k => { costOptPct[k] = params.costOpt || 0 })
    const costs = computeMonthlyCosts(factBlockTotals, costOptPct, params.revenueGrowth, params.inflationPct || _state.inflationPct || 0)
    const withdrawalPerMonth = params.withdrawalLimit

    const gapDebt = _state.cashGapDebt || 5_431_123
    let cum = -gapDebt  // стартуем от долга (отрицательное)
    const monthly = revenues.map((rev, i) => rev - costs.byMonth[i] - withdrawalPerMonth)
    const cumulative = monthly.map(v => { cum += v; return cum })

    return { monthly, cumulative, revenues, costs }
  }

  /**
   * Когда кумулятивный остаток пересекает 0 (выход из разрыва).
   * @param {number[]} cumulative
   * @returns {number|null} индекс месяца или null
   */
  function computeGapClosure (cumulative) {
    for (let i = 0; i < cumulative.length; i++) {
      if (cumulative[i] >= 0) return i
    }
    return null
  }

  /**
   * Многолетний прогноз.
   * @returns Array<{ year, revenue, cogs, profit, margin, orders, avgCheck }>
   */
  function computeGrowthPlan (fact2025) {
    const base = { revenue: fact2025.revenue || 101_065_615 }
    const baseCogs = fact2025.totalCogs || 96_825_783
    const results = []
    let prevRevenue = base.revenue
    let prevCogs = baseCogs
    const years = [2026, 2027, 2028]

    // Средневзвешенная эластичность расходов (~0.65)
    const AVG_ELASTICITY = 0.65

    years.forEach(year => {
      const params = _state.growthPlan[year] || {}
      // 2026: синхронизируем с ползунком на странице "2026 — План"
      const growth = year === 2026
        ? (_state.revenueGrowthPct != null ? _state.revenueGrowthPct : (params.revenueGrowth || 25))
        : (params.revenueGrowth || 20)
      const costOpt = year === 2026
        ? Math.round(Object.values(_state.costOpt || {}).reduce((s, v) => s + v, 0) / 6)
        : (params.costOpt || 5)
      const revenue = Math.round(prevRevenue * (1 + growth / 100))
      // Расходы: Факт × (1 + рост%) × (1 - оптимизация%)
      const cogsGrowthFactor = (1 + growth / 100) * (1 - costOpt / 100)
      const cogs = Math.round(prevCogs * cogsGrowthFactor)
      const profit = revenue - cogs
      const margin = profit / revenue * 100

      // Оценочные Orders и avgCheck
      const baseOrders = 3200  // из PROMPT-03: 3200 заказов/год 2025
      const baseCheck  = 24612
      const orders = Math.round(baseOrders * (1 + growth / 100 * 0.8))
      const avgCheck = Math.round(revenue / orders)

      results.push({ year, revenue, cogs, profit, margin, orders, avgCheck, growth, costOpt })
      prevRevenue = revenue
      prevCogs = cogs
    })

    return results
  }

  // Загрузить при старте
  load()

  global.ScenarioEngine = {
    load, save, getState, setState, onChange,
    computeMonthlyRevenue,
    computeMonthlyRevenueQ,
    computeMonthlyCosts,
    computeScenario,
    computeGapClosure,
    computeGrowthPlan,
    SEASONAL_COEF
  }

})(window)
