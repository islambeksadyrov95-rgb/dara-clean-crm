;(function (global) {
  'use strict'

  const STORAGE_KEY = 'dc-finplan'

  // Доля переменных расходов в каждом блоке (0 = полностью фиксированный, 1 = полностью переменный).
  // Переменные расходы масштабируются с ростом выручки; фиксированные — только на инфляцию.
  //
  // Калиброваны по детальному анализу статей факта 2025 (Excel «Для анализа 2025»):
  //
  // ПРОИЗВОДСТВО (61 975 068):
  //   Фиксированные (74%): ФОТ оклад ЦЕХ 42.9M + ФОТ больничный 1.3M + аренда Агбиса 300K
  //                        + продукты цех 1.5M + коммунальные-база (60%) 2.4M
  //   Переменные   (15%): химия/материалы/хоз.рас 4.6M + ФОТ аутсорс+бонусы 0.6M
  //                        + оплата услуг штор и тюлей + коммунальные-переменная (40%) 1.6M
  //   Условно-пер. (11%): приобретение для цеха, ремонт ковров, поставщик прочее
  //
  // ЛОГИСТИКА (10 356 181):
  //   Переменные   (65%): ГСМ 3.2M (100%) + Такси 97K (100%) + Мойка 43K (100%)
  //                        + Обед водителям 2.2M (70%) + Ремонт/Запчасти 4.3M (50%)
  //   Фиксированные(35%): Страховка + Техосмотр + Трекер + Замена шин/масла/колодок
  //
  // МАРКЕТИНГ (16 815 222):
  //   Переменные   (70%): Google+Instagram+TikTok+Yandex (performance, масштабируется с планом)
  //                        + разовые кампании (блогер, съемки, модель)
  //   Фиксированные(30%): 2ГИС годовой контракт + Наружная + СММ/Контекстолог/Таргетолог (ретейнеры)
  //
  // ПРОДАЖИ (1 170 420):
  //   Фиксированные(85%): ФОТ оклад 158K + Телефония 325K + Wazzup 195K + Канцелярия 97K
  //   Переменные   (15%): Приобретение для отдела продаж (частично под найм/рост)
  //
  // НАЛОГИ (3 211 343):
  //   Фиксированные(80%): Налоги_1 (ОПВ, СО, ВОСМС — привязаны к ФОТ, который фиксирован)
  //   Переменные   (20%): Тариф банка (% оборота) + налоги от найма при росте штата
  //
  // НАКЛАДНЫЕ (2 350 576):
  //   Фиксированные(75%): Интернет + Битрикс + Бухгалтер + Юрист + Содержание офиса + Тимбилдинг
  //   Переменные   (25%): Объявления о найме + Единоразовые + Прочие расходы + Типография
  //
  // Взвешенная переменная доля по COGS: ~30% (blended)
  const VARIABLE_SHARE = {
    production: 0.15,
    logistics:  0.65,
    marketing:  0.70,
    sales:      0.15,
    taxes:      0.20,
    overhead:   0.25,
  }

  // Взвешенная переменная доля (для сводных расчётов типа computeGrowthPlan)
  // = Σ(блок × VARIABLE_SHARE[блок]) / COGS = 29 200 000 / 95 878 810 ≈ 0.30
  const BLENDED_VARIABLE_SHARE = 0.30

  const SEASONAL_COEF = (function () {
    // Из FACT_2025_MONTHLY.revenue (Excel «Для анализа 2025», все 12 месяцев)
    // Сен и Окт исправлены: +600K пополнение Kaspi Pay (Сен) и +3M (Окт)
    const rev = [4066009, 5073529, 5936965, 7752958, 9441972, 11231195,
                 11139195, 7512538, 13987344, 11950309, 10010031, 15103879]
    const total = rev.reduce((s, v) => s + v, 0)
    return rev.map(v => v / total * 12)  // * 12 чтобы среднее = 1.0
  })()

  const DEFAULT_STATE = {
    revenueGrowthPct:    25,
    quarterCoef:         [1, 1, 1, 1],  // квартальные множители Q1-Q4
    inflationPct:         8,    // средняя инфляция по РК
    withdrawalLimit:    300000,
    withdrawalInCogs:   true,   // true = вывод включён в расходы; false = ниже черты (распределение прибыли)
    targetMarginPct:     15,
    costOpt: { production: 0, logistics: 0, marketing: 10, sales: 0, taxes: 0, overhead: 0 },
    fleetParams: { cars: 3, addressesPerCarDay: 30, orderSharePct: 50, workingDaysMonth: 22 },
    // Кассовый разрыв: итог 2025 (Чистый доход за год = -3 259 938 ₸)
    cashGapDebt: 3_259_938,       // начальный долг на 01.01.2026 (= abs(yearEndDeficit 2025))
    cashGapMonthlyPayment: 0,     // фиксированный платёж (0 = погашение из прибыли)
    cashGapStartMonth: 0,         // месяц начала погашения (0=янв)
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
    // Формула: Факт × (1 + variableShare[k] × рост%) × (1 + инфляция%) × (1 - оптимизация%)
    // Инфляция применяется ко всем расходам — ФОТ, ГСМ, поставщики растут независимо от нас.
    // Рост выручки влияет только на ПЕРЕМЕННУЮ часть каждого блока — остальное фиксированные расходы.
    const inflMul = 1 + (inflationPct || 0) / 100
    const totals = {}
    BLOCK_KEYS.forEach(k => {
      const opt = (costOptPct[k] || 0) / 100
      const varShare = VARIABLE_SHARE[k] || 0
      const effectiveGrowthFactor = 1 + varShare * (growthPct || 0) / 100
      totals[k] = Math.round(factBlockTotals[k] * effectiveGrowthFactor * inflMul * (1 - opt))
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

    const gapDebt = _state.cashGapDebt || 3_259_938
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
    const base = { revenue: fact2025.revenue || 113_205_924 }
    const baseCogs = fact2025.totalCogs || 95_878_810
    const results = []
    let prevRevenue = base.revenue
    let prevCogs = baseCogs
    // Компаундный рост заказов от реального факта 2025 (4 106 по плану продаж)
    // Заказы растут медленнее выручки — средний чек тоже растёт (0.8 = эластичность заказов)
    let prevOrders = fact2025.orders || 4_106
    const years = [2026, 2027, 2028]

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

      // Расходы — модель с разделением на переменные и постоянные:
      //   COGS_план = COGS_база × [ varShare × (1 + рост%) + fixShare × (1 + инфляция%) ] × (1 - оптимизация%)
      //
      // Переменная часть (30% COGS) масштабируется с ростом выручки.
      // Постоянная часть (70% COGS) растёт только на инфляцию — ФОТ, аренда, подписки.
      // Это даёт операционный рычаг: при росте выручки на X% маржа растёт нелинейно.
      const inflMul = 1 + (_state.inflationPct || 8) / 100
      const varShare = BLENDED_VARIABLE_SHARE          // 0.30
      const fixShare = 1 - varShare                    // 0.70
      const cogsGrowthFactor = (varShare * (1 + growth / 100) + fixShare * inflMul) * (1 - costOpt / 100)
      const cogs = Math.round(prevCogs * cogsGrowthFactor)
      const profit = revenue - cogs
      const margin = profit / revenue * 100

      // Заказы: компаундный рост от предыдущего года (не от hardcoded базы).
      // Коэффициент 0.8 — заказы растут медленнее выручки (остаток идёт в рост среднего чека).
      const orders = Math.round(prevOrders * (1 + growth / 100 * 0.8))
      const avgCheck = Math.round(revenue / orders)

      results.push({ year, revenue, cogs, profit, margin, orders, avgCheck, growth, costOpt })
      prevRevenue = revenue
      prevCogs = cogs
      prevOrders = orders
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
    SEASONAL_COEF,
    VARIABLE_SHARE,
    BLENDED_VARIABLE_SHARE
  }

})(window)
