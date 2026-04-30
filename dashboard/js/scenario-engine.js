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
    revenueGrowthPct:    20,   // 20% = базовый тренд Q1 2026 vs Q1 2025 (~21-26% факт)
    quarterCoef:         [1, 1, 1, 1],  // квартальные множители Q1-Q4
    inflationPct:         8,    // для многолетнего прогноза 2027-2028; в 2026 уже в costScale
    withdrawalLimit:  1_000_000,
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
      if (saved) {
        // Миграция: сбрасываем устаревший дефолт кассового разрыва (5 431 123 → 3 259 938)
        if (saved.cashGapDebt === 5_431_123) delete saved.cashGapDebt
        if (saved.cashGapMonthlyPayment === 364_605) delete saved.cashGapMonthlyPayment
        // Миграция: revenueGrowthPct 0 и 25 — оба некорректные старые значения, сброс → 20
        if (saved.revenueGrowthPct === 25 || saved.revenueGrowthPct === 0) delete saved.revenueGrowthPct
        // Миграция: withdrawalLimit 300 000 — старый дефолт, сброс → 1 000 000 (по факту Q1 2026)
        if (saved.withdrawalLimit === 300000) delete saved.withdrawalLimit
        _state = Object.assign({}, DEFAULT_STATE, saved)
      }
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
   * Вычислить помесячный план выручки 2026 с реальным Q1 в основе.
   * Январь–Март = факт 2026 (locked, не зависит от слайдеров).
   * Апрель–Декабрь = fact2025[m] × (1 + growth%) × qCoef[q]
   * Формула: аналог прошлого года умноженный на % роста.
   * @param {number[]} fact2025monthly — FACT_2025_MONTHLY.revenue (12 эл.)
   * @param {Object}   state — текущий state (revenueGrowthPct, quarterCoef)
   * @returns {number[]} 12 элементов
   */
  function computeMonthlyRevenue2026 (fact2025monthly, state) {
    const FACT_Q1  = [5130618, 6371463, 7160577]   // Jan-Mar 2026 факт (янв = услуги + пополнение 4.82M)
    const growth   = 1 + (state.revenueGrowthPct || 0) / 100
    const qCoef    = state.quarterCoef || [1, 1, 1, 1]

    // Минимальная база выручки с июля (индекс 6): 11.5M тенге
    // Защищает от аномально слабых месяцев 2025 (август 2025 = 7.5M)
    const MIN_BASE_FROM_JULY = 11_500_000

    return fact2025monthly.map((fact2025, i) => {
      if (i < 3) return FACT_Q1[i]   // Jan-Mar — факт, locked
      const q = Math.floor(i / 3)
      // Apr-Dec: факт прошлого года × (1 + % роста) × квартальный коэффициент
      // С июля — минимальная база 11.5M перед применением роста
      const base = (i >= 6) ? Math.max(fact2025, MIN_BASE_FROM_JULY) : fact2025
      return Math.round(base * growth * qCoef[q])
    })
  }

  /**
   * Вычислить помесячные расходы 2026 на основе реальных данных 2025 (по месяцам).
   *
   * Ключевой принцип: фиксированные и переменные расходы имеют разные сезонные профили.
   *
   *   ФИКСИРОВАННЫЕ (ФОТ, аренда, подписки):
   *     → одинаковы каждый месяц = годовой_итог × fixShare × costScale / 12
   *     → НЕ следуют сезону выручки
   *
   *   ПЕРЕМЕННЫЕ (химия, ГСМ, реклама performance):
   *     → следуют сезонному профилю расходов 2025 (fact2025opExp[m])
   *     → растут с ростом выручки: × (1 + growth%)
   *
   * Инфляция НЕ применяется — уже в costScale (Q1 2026 / Q1 2025 = 1.1586).
   * Q1 (Jan-Mar): возвращает нули — заполняется фактом FACT_2026_Q1 снаружи.
   *
   * @param {number[]} fact2025opExp   — FACT_2025_MONTHLY.opExpense (12 эл., сезонный профиль)
   * @param {Object}   factBlockTotals — { production: N, ... } годовые итоги блоков за 2025
   * @param {Object}   state           — ScenarioEngine state (revenueGrowthPct, costOpt)
   * @param {number}   costScale       — коэффициент Q1-2026/Q1-2025 (1.1586)
   * @returns {{ byMonth: number[], byBlock: {k: number[]} }}
   */
  function computeMonthlyExpenses2026 (fact2025opExp, factBlockTotals, state, costScale) {
    const BLOCK_KEYS  = ['production', 'logistics', 'marketing', 'sales', 'taxes', 'overhead']
    const growth      = (state.revenueGrowthPct || 0) / 100
    const costOptPct  = state.costOpt || {}
    const scale       = costScale || 1

    // Суммарные годовые расходы 2025 для нормировки переменной части
    const totalAnnual = BLOCK_KEYS.reduce((s, k) => s + (factBlockTotals[k] || 0), 0)

    const byBlock = {}
    BLOCK_KEYS.forEach(k => {
      const varShare  = VARIABLE_SHARE[k] || 0
      const fixShare  = 1 - varShare
      const opt       = (costOptPct[k] || 0) / 100
      const annual    = factBlockTotals[k] || 0

      // Фиксированная часть блока: годовой × fixShare × costScale / 12 (одинакова каждый месяц)
      const fixMonthly = Math.round(annual * fixShare * scale / 12 * (1 - opt))

      // Переменная часть: сезонный профиль из факта 2025 × доля блока × рост выручки
      // Нормируем через totalAnnual чтобы сумма за год = annual × varShare × scale × (1+growth%)
      const varAnnualBase = annual * varShare * scale * (1 + growth) * (1 - opt)
      const fact2025total = fact2025opExp.reduce((s, v) => s + v, 0) || 1

      byBlock[k] = fact2025opExp.map((exp2025, i) => {
        if (i < 3) return 0  // Q1 — факт, заполняется отдельно
        // Переменная часть: пропорционально месячному профилю расходов 2025
        const varMonthly = Math.round(varAnnualBase * exp2025 / fact2025total)
        return fixMonthly + varMonthly
      })
    })

    const byMonth = new Array(12).fill(0).map((_, i) =>
      i < 3 ? 0 : BLOCK_KEYS.reduce((s, k) => s + byBlock[k][i], 0)
    )

    return { byMonth, byBlock }
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
   * Использует ту же логику что и основной план 2026:
   *   - Выручка: Q1 факт locked + Apr-Dec = fact2025[m] × (1 + рост%)
   *   - Расходы: Q1 факт locked + Apr-Dec = computeMonthlyExpenses2026
   *   - Вывод:   Q1 факт + Apr-Dec = withdrawalLimit сценария
   *   - Кредит:  фиксированный график LOAN_REPAYMENTS_2026
   *
   * @param {{ revenue, totalCogs, withdrawals }} fact2025Totals
   * @param {{ revenueGrowth, costOpt, withdrawalLimit }} params
   * @returns {{ monthly: number[], cumulative: number[], revenues: number[], costs: {byMonth: number[]} }}
   */
  function computeScenario (fact2025Totals, params) {
    const FD        = global.FinanceData
    const fact2025M  = FD && FD.FACT_2025_MONTHLY
    const fact2026Q1 = FD && FD.FACT_2026_Q1
    const BLOCK_KEYS = ['production', 'logistics', 'marketing', 'sales', 'taxes', 'overhead']

    // ── Выручка ───────────────────────────────────────────────────────────────
    // Q1 2026 = факт (locked); Apr-Dec = факт2025[m] × (1 + рост%) × qCoef [1,1,1,1]
    const scenRevState = { revenueGrowthPct: params.revenueGrowth || 0, quarterCoef: [1, 1, 1, 1] }
    const revenues = fact2025M
      ? computeMonthlyRevenue2026(fact2025M.revenue, scenRevState)
      : computeMonthlyRevenue(fact2025Totals.revenue, params.revenueGrowth)

    // ── Расходы ───────────────────────────────────────────────────────────────
    // Q1 2026 = факт (locked); Apr-Dec = та же формула что основной план
    const factBlockTotals = {}
    const factBlocks = FD && FD.BLOCK_META
    BLOCK_KEYS.forEach(k => {
      factBlockTotals[k] = factBlocks ? factBlocks[k].factTotal : fact2025Totals.totalCogs / 6
    })
    const costScaleVal = fact2026Q1 ? fact2026Q1.costScale : 1.1586
    const optObj = {}
    BLOCK_KEYS.forEach(k => { optObj[k] = params.costOpt || 0 })
    const scenExpState = { revenueGrowthPct: params.revenueGrowth || 0, inflationPct: 0, costOpt: optObj }

    const expData = fact2025M
      ? computeMonthlyExpenses2026(fact2025M.opExpense, factBlockTotals, scenExpState, costScaleVal)
      : computeMonthlyCosts(factBlockTotals, optObj, params.revenueGrowth, 0)

    const q1Exp = fact2026Q1 ? fact2026Q1.opExpense : [0, 0, 0]
    const expByMonth = expData.byMonth.map((e, i) => i < 3 ? q1Exp[i] : e)

    // ── Вывод средств ─────────────────────────────────────────────────────────
    // Q1 = факт; Apr-Dec = лимит сценария
    const q1Wd = fact2026Q1 ? fact2026Q1.withdrawal : [0, 0, 0]
    const withdrawals = revenues.map((_, i) => i < 3 ? q1Wd[i] : params.withdrawalLimit)

    // ── Погашение кредита — фиксированный график 2026 ─────────────────────────
    const loans = FD && FD.LOAN_REPAYMENTS_2026
      ? FD.LOAN_REPAYMENTS_2026.monthly
      : new Array(12).fill(364605)

    // ── Cash flow ─────────────────────────────────────────────────────────────
    const gapDebt = _state.cashGapDebt || 3_259_938
    let cum = -gapDebt
    const monthly = revenues.map((rev, i) =>
      rev - expByMonth[i] - withdrawals[i] - loans[i]
    )
    const cumulative = monthly.map(v => { cum += v; return cum })

    return { monthly, cumulative, revenues, costs: { byMonth: expByMonth } }
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
      const inflMul = 1 + (_state.inflationPct || 0) / 100
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
    computeMonthlyRevenue2026,
    computeMonthlyExpenses2026,
    computeMonthlyCosts,
    computeScenario,
    computeGapClosure,
    computeGrowthPlan,
    SEASONAL_COEF,
    VARIABLE_SHARE,
    BLENDED_VARIABLE_SHARE
  }

})(window)
