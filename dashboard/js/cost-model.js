;(function (global) {
  'use strict'

  // ─── ФАКТ 2025 (синхронизировано с Excel «Для анализа 2025» и BLOCK_META) ──
  const FACTS = {
    revenue:      113_205_924,  // ИТОГО ДОХОДЫ из Excel (Услуги + Пополнение Kaspi Pay)
    totalOrders:  4_106,
    totalSqm:     101_000,
    avgCheck:     27_573,       // revenue / orders = 113 205 924 / 4 106
    avgPriceSqm:  1_000,

    blocks: {
      production: { label: 'Производство',  fact: 61_975_068, color: '#8B5CF6', note: 'ФОТ цех, химия, коммунальные, аренда цеха' },
      logistics:  { label: 'Логистика',     fact: 10_356_181, color: '#F59E0B', note: 'ГСМ, ТО автопарка, водители' },
      marketing:  { label: 'Маркетинг',     fact: 16_815_222, color: '#3B82F6', note: 'Google Ads, 2ГИС, прочее' },
      sales:      { label: 'Продажи',       fact:  1_170_420, color: '#10B981', note: 'ФОТ продаж, CRM, телефония' },
      tax:        { label: 'Налоги',        fact:  3_211_343, color: '#6B7280', note: 'ОПВ, СО, ВОСМС, банковский тариф' },
      overhead:   { label: 'Операционные',  fact:  2_350_576, color: '#EC4899', note: 'Интернет, подписки, бухгалтер, юрист' }
    },
    totalCogs: 95_878_810,  // ИТОГО COGS = сумма 6 блоков (без вывода средств и фин.операций)

    // Break-even (на основе разделения переменных и постоянных расходов из анализа 2025)
    // Постоянные (70% COGS = ~67M): ФОТ оклад, аренда, подписки, фикс. ТО, коммунальные-база
    // Переменные (30% COGS = ~29M): химия, ГСМ, аутсорс, перф-реклама, коммунальные-расход
    fixedCostsYear:    66_700_000,  // 95 878 810 × 0.70
    variablePerOrder:   7_100,      // 95 878 810 × 0.30 / 4 106 заказов
    factOrdersMonth:   342,

    // CAC / LTV
    ltv: 61_530,
    avgOrdersLifetime: 2.5,
    // Blended CAC: агрегатный метод (315 заказов/21дн × 30/21 = 450/мес × 63.5% = ~286 новых)
    blendedNewOrdersMonth: 286,
    // Данные из Excel "Отдел Продаж Апрель.xlsx" (21 рабочий день 6-26 апр)
    // Пересчёт на месяц: value / 21 * 30
    channels: [
      // Google: $999.51/21дн = $47.60/дн × 30 = $1,427.87/мес × 480₸/$ = 685,378₸/мес
      // 183 обращ/21дн, конверсия 42% → 77 заказов/21дн → CPL=$5.46, CAC=$12.98
      { id: 'google',   label: 'Google Ads',       budgetMonth: 685_378, inquiries: 261, orders: 110, newPct: 0.90 },
      // 2GIS: 304,152₸/мес (годовой контракт). 158 обращ/21дн → 226/мес, ~103 заказов/мес
      { id: '2gis',     label: '2ГИС',             budgetMonth: 304_152, inquiries: 226, orders: 103, newPct: 0.85 },
      // Instagram+TikTok: 5+4=9 обращ/21дн → 13/мес, ~5 заказов
      { id: 'insta',    label: 'Instagram/TikTok', budgetMonth:  19_500, inquiries: 13,  orders: 5,   newPct: 1.00 },
      // Рекомендация: 42 обращ/21дн → 60/мес, ~43 заказов
      { id: 'referral', label: 'Рекомендация',     budgetMonth: 0,       inquiries: 60,  orders: 43,  newPct: 0.50 },
      // Постоянный: 145 обращ/21дн → 207/мес, ~176 заказов
      { id: 'repeat',   label: 'Постоянный',       budgetMonth: 0,       inquiries: 207, orders: 176, newPct: 0    }
    ]
  }

  // ─── ИСТОЧНИКИ ДАННЫХ (для прозрачности) ──────────────────────────────────
  const FACT_SOURCES = {
    totalSqm: 'Расчёт: Выручка (113M ₸) / Средняя цена за кв.м. (~1,000 ₸) = 101,000 кв.м.',
    totalOrders: 'Из CRM Битрикс24: 4,106 заказов за 2025 год',
    avgCheck: 'Расчёт: Выручка (113 205 924 ₸) / Заказы (4,106) = 27,573 ₸',
    avgPriceSqm: 'Средняя рыночная цена химчистки ковров: ~1,000 ₸/кв.м.',
    fixedCostsYear: 'Постоянные расходы (70% COGS): ФОТ оклад, аренда, подписки, фикс.ТО, коммунальные-база = ~66.7M ₸/год',
    variablePerOrder: 'Переменные расходы (30% COGS = ~28.7M) / 4,106 заказов = ~7,100 ₸/заказ. Включают: химия, ГСМ, аутсорс, перф-реклама',
    blocks: {
      production: 'ФОТ цех (оклады, бонусы, больничные), химия (шампуни, хим.составы), коммунальные (свет, газ, вода), оборудование, аренда цеха',
      logistics: 'ГСМ, ТО автопарка (замена шин, масло, ремонт), ФОТ водителей, страховка',
      marketing: 'Google Ads, 2ГИС, Instagram/TikTok, наружная реклама, SMM, контекстолог, таргетолог',
      sales: 'ФОТ отдела продаж, CRM (Wazzup), телефония (Кар Тел), канцелярия',
      tax: 'Налог по упрощёнке 3% + банковский тариф',
      overhead: 'Интернет, подписки (Битрикс), бухгалтер, юрист, содержание офиса'
    },
    dataSource: 'Данные из Excel файла "Финансы DaraClean 2025-2026.xlsx", лист "ДДС 2025"'
  }

  const BLOCK_KEYS = ['production', 'logistics', 'marketing', 'sales', 'tax', 'overhead']
  const LS_KEY = 'dc-cost'

  // ─── LOCALSTORAGE ──────────────────────────────────────────────────────────
  function defaultPlan () {
    const planBlocks = {}
    BLOCK_KEYS.forEach(k => { planBlocks[k] = FACTS.blocks[k].fact })
    const channelBudgets = {}
    FACTS.channels.forEach(c => { channelBudgets[c.id] = c.budgetMonth })
    return { version: 1, planBlocks, planPrice: FACTS.avgCheck, channelBudgets, totalSqm: FACTS.totalSqm }
  }

  function loadPlan () {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return defaultPlan()
      const saved = JSON.parse(raw)
      if (saved.version !== 1) return defaultPlan()
      const def = defaultPlan()
      // Merge — saved значения перекрывают дефолт
      BLOCK_KEYS.forEach(k => {
        const v = saved.planBlocks && saved.planBlocks[k]
        def.planBlocks[k] = (typeof v === 'number' && v >= 0) ? v : def.planBlocks[k]
      })
      if (typeof saved.planPrice === 'number' && saved.planPrice > 0) def.planPrice = saved.planPrice
      if (typeof saved.totalSqm === 'number' && saved.totalSqm > 0) def.totalSqm = saved.totalSqm
      FACTS.channels.forEach(c => {
        const v = saved.channelBudgets && saved.channelBudgets[c.id]
        def.channelBudgets[c.id] = (typeof v === 'number' && v >= 0) ? v : def.channelBudgets[c.id]
      })
      return def
    } catch (e) {
      return defaultPlan()
    }
  }

  function savePlan (plan) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(plan)) } catch (e) { /* ignore quota */ }
  }

  // ─── ВЫЧИСЛЕНИЯ ───────────────────────────────────────────────────────────
  function computeCost (plan) {
    const planTotalCogs = BLOCK_KEYS.reduce((s, k) => s + (plan.planBlocks[k] || 0), 0)
    const planPrice     = plan.planPrice || FACTS.avgCheck
    const totalSqm      = plan.totalSqm || FACTS.totalSqm
    const planCostPerOrder  = planTotalCogs / FACTS.totalOrders
    const planProfitPerOrder = planPrice - planCostPerOrder
    const planMargin    = planPrice > 0 ? planProfitPerOrder / planPrice : 0
    const planCostPerSqm = planTotalCogs / totalSqm

    // Факт
    const factCostPerOrder  = FACTS.totalCogs / FACTS.totalOrders
    const factProfitPerOrder = FACTS.avgCheck - factCostPerOrder
    const factMargin     = factProfitPerOrder / FACTS.avgCheck
    const factCostPerSqm  = FACTS.totalCogs / totalSqm

    // По блокам
    const blockRows = BLOCK_KEYS.map(k => {
      const b = FACTS.blocks[k]
      const factAmt   = b.fact
      const planAmt   = plan.planBlocks[k] || 0
      const factPct   = FACTS.totalCogs > 0 ? factAmt / FACTS.totalCogs : 0
      const planPct   = planTotalCogs  > 0 ? planAmt  / planTotalCogs  : 0
      const factPerSqm  = factAmt / totalSqm
      const factPerOrder = factAmt / FACTS.totalOrders
      const planPerSqm  = planAmt / totalSqm
      const planPerOrder = planAmt / FACTS.totalOrders
      const delta = factAmt > 0 ? (planAmt - factAmt) / factAmt * 100 : 0
      return {
        key: k, label: b.label, color: b.color, note: b.note,
        factAmt, planAmt,
        factPct, planPct,
        factPerSqm, factPerOrder,
        planPerSqm, planPerOrder,
        delta
      }
    })

    // Цветовые пороги маржи
    const marginColor = planMargin >= 0.20 ? 'good' : planMargin >= 0.10 ? 'warn' : 'bad'
    const factMarginColor = factMargin >= 0.20 ? 'good' : factMargin >= 0.10 ? 'warn' : 'bad'

    return {
      blockRows,
      planTotalCogs, factTotalCogs: FACTS.totalCogs,
      planPrice, factPrice: FACTS.avgCheck,
      planCostPerOrder, factCostPerOrder,
      planCostPerSqm, factCostPerSqm,
      planProfitPerOrder, factProfitPerOrder,
      planMargin, factMargin,
      marginColor, factMarginColor,
      // дельты итогов
      totalCogsDelta: FACTS.totalCogs > 0 ? (planTotalCogs - FACTS.totalCogs) / FACTS.totalCogs * 100 : 0,
      priceDelta:     FACTS.avgCheck  > 0 ? (planPrice - FACTS.avgCheck) / FACTS.avgCheck * 100 : 0
    }
  }

  function computeCAC (plan) {
    const rows = FACTS.channels.map(ch => {
      const planBudget = plan.channelBudgets[ch.id] || 0
      const factBudget = ch.budgetMonth
      const newOrders  = Math.round(ch.orders * ch.newPct)
      // CAC = бюджет / новые заказы
      const factCAC  = newOrders > 0 && factBudget > 0 ? factBudget / newOrders : 0
      const planCAC  = newOrders > 0 && planBudget > 0 ? planBudget / newOrders : 0
      // LTV/CAC
      const factLtvCac = factCAC > 0 ? FACTS.ltv / factCAC : null
      const planLtvCac = planCAC > 0 ? FACTS.ltv / planCAC : null
      // Прогноз заказов (пропорционально бюджету, только платные каналы)
      let forecastOrders = ch.orders
      if (factBudget > 0 && planBudget > 0) {
        forecastOrders = Math.round(ch.orders * (planBudget / factBudget))
      }
      const forecastRevenue = forecastOrders * FACTS.avgCheck
      const budgetDelta = factBudget > 0 ? (planBudget - factBudget) / factBudget * 100 : 0

      return {
        id: ch.id, label: ch.label,
        factBudget, planBudget, budgetDelta,
        inquiries: ch.inquiries, orders: ch.orders, newOrders,
        factCAC, planCAC,
        ltv: FACTS.ltv,
        factLtvCac, planLtvCac,
        forecastOrders, forecastRevenue,
        isPaid: factBudget > 0
      }
    })

    // Blended CAC — агрегатный метод (PROMPT-02)
    // Числитель: сумма бюджетов платных каналов
    // Знаменатель: FACTS.blendedNewOrdersMonth = 200 (315 заказов × 63.5% новых)
    const paidRows = rows.filter(r => r.isPaid)
    const totalFactBudget = paidRows.reduce((s, r) => s + r.factBudget, 0)
    const totalPlanBudget = paidRows.reduce((s, r) => s + r.planBudget, 0)
    const blendedDenom    = FACTS.blendedNewOrdersMonth  // ~200
    const blendedFactCAC  = blendedDenom > 0 && totalFactBudget > 0 ? totalFactBudget / blendedDenom : 0
    const blendedPlanCAC  = blendedDenom > 0 && totalPlanBudget > 0 ? totalPlanBudget / blendedDenom : 0

    return { rows, blendedFactCAC, blendedPlanCAC, ltv: FACTS.ltv }
  }

  function computeBreakeven (plan) {
    const planPrice = plan.planPrice || FACTS.avgCheck
    const variable  = FACTS.variablePerOrder
    const fixed     = FACTS.fixedCostsYear

    const contributionMarginFact = FACTS.avgCheck - variable
    const contributionMarginPlan = planPrice - variable

    const beOrdersYearFact = contributionMarginFact > 0 ? fixed / contributionMarginFact : null
    const beOrdersYearPlan = contributionMarginPlan > 0 ? fixed / contributionMarginPlan : null
    const beOrdersMonthFact = beOrdersYearFact ? beOrdersYearFact / 12 : null
    const beOrdersMonthPlan = beOrdersYearPlan ? beOrdersYearPlan / 12 : null
    const beOrdersDayFact   = beOrdersMonthFact ? beOrdersMonthFact / 21.5 : null
    const beOrdersDayPlan   = beOrdersMonthPlan ? beOrdersMonthPlan / 21.5 : null

    const factMonth = FACTS.factOrdersMonth
    const safetyPct = beOrdersMonthFact ? (factMonth - beOrdersMonthFact) / factMonth * 100 : null
    const safetyColor = safetyPct === null ? 'bad' : safetyPct >= 20 ? 'good' : safetyPct >= 10 ? 'warn' : 'bad'

    return {
      fixedCostsYear: fixed, variablePerOrder: variable,
      contributionMarginFact, contributionMarginPlan,
      beOrdersYearFact, beOrdersYearPlan,
      beOrdersMonthFact, beOrdersMonthPlan,
      beOrdersDayFact, beOrdersDayPlan,
      factOrdersMonth: factMonth,
      safetyPct, safetyColor
    }
  }

  function computeAll () {
    const plan = loadPlan()
    return {
      plan,
      cost:      computeCost(plan),
      cac:       computeCAC(plan),
      breakeven: computeBreakeven(plan)
    }
  }

  // ─── DEBOUNCE ─────────────────────────────────────────────────────────────
  function debounce (fn, ms) {
    let timer
    return function (...args) {
      clearTimeout(timer)
      timer = setTimeout(() => fn.apply(this, args), ms)
    }
  }

  // ─── ЭКСПОРТ ──────────────────────────────────────────────────────────────
  global.DaraCostModel = {
    FACTS, FACT_SOURCES, BLOCK_KEYS,
    loadPlan, savePlan, defaultPlan,
    computeCost, computeCAC, computeBreakeven, computeAll,
    debounce
  }
})(window)
