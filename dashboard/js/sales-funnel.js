;(function (global) {
  const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n))
  const fmtMoney = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₸'
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

  const parseISO = (iso) => new Date(iso + 'T12:00:00').getTime()

  const inRange = (iso, from, to) => {
    const t = parseISO(iso)
    return t >= from && t <= to
  }

  const slugify = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/google/i, 'google')
      .replace(/2gis|2гис/i, '2gis')
      .replace(/яндекс|yandex/i, 'yandex')
      .replace(/instagram|инстаграм/i, 'instagram')
      .replace(/tiktok|тикток/i, 'tiktok')
      .replace(/рекоменд|сараф/i, 'referral')
      .replace(/постоянн/i, 'repeat')
      .replace(/старая база/i, 'old_base')
      .trim()

  const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()

  const weeksInMonth = (year, month) => Math.ceil(daysInMonth(year, month) / 7)

  // Загрузить сохранённые параметры планирования
  const loadPlanParams = (rawData) => {
    try {
      const stored = localStorage.getItem('daraclean_plan_params')
      if (stored) {
        const p = JSON.parse(stored)
        if (p && typeof p === 'object') return p
      }
    } catch (_) {}
    const yearly = (rawData.plans && rawData.plans.yearly) || {}
    return {
      yearRevenue: yearly.revenue || 101065615,
      yearOrders: yearly.orders || 4106,
      targetAvgCheck: yearly.avgCheck || 24612,
      targetConversion: yearly.conversion || 0.529,
      withdrawalCap: 300000,
      growthPct: 25,
      seasonal: (rawData.plans && rawData.plans.seasonal) || Array(12).fill(1)
    }
  }

  // Декомпозиция годового плана
  const decompPlan = (params) => {
    const { yearRevenue, yearOrders, seasonal, targetConversion } = params
    const seasonSum = seasonal.reduce((s, c) => s + c, 0)

    const today = new Date()
    const todayISO = today.toISOString().slice(0, 10)
    const todayYear = today.getFullYear()
    const todayMonth = today.getMonth()
    const todayDay = today.getDate()

    const monthly = seasonal.map((coeff, m) => {
      const share = coeff / seasonSum
      return {
        month: m,
        label: MONTHS_RU[m],
        revenueTarget: Math.round(yearRevenue * share),
        ordersTarget: Math.round(yearOrders * share),
        leadsTarget: Math.round((yearOrders * share) / (targetConversion || 0.5))
      }
    })

    const quarterly = [0, 1, 2, 3].map((q) => {
      const months = monthly.slice(q * 3, q * 3 + 3)
      return {
        q: q + 1,
        label: `Q${q + 1}`,
        revenueTarget: months.reduce((s, m) => s + m.revenueTarget, 0),
        ordersTarget: months.reduce((s, m) => s + m.ordersTarget, 0)
      }
    })

    // Текущий месяц — декомпозиция по дням
    const curMonth = monthly[todayMonth]
    const days = daysInMonth(todayYear, todayMonth)
    const dailyOrderTarget = curMonth.ordersTarget / days
    const dailyRevenueTarget = curMonth.revenueTarget / days

    // Дневной трекер для текущего месяца
    const planFactDaily = []
    let cumOrderTarget = 0
    let cumRevenueTarget = 0
    for (let d = 1; d <= days; d++) {
      const dateISO = `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cumOrderTarget += dailyOrderTarget
      cumRevenueTarget += dailyRevenueTarget
      const isWeekStart = d > 1 && (d - 1) % 7 === 0
      planFactDaily.push({
        date: dateISO,
        day: d,
        orderTarget: Math.round(dailyOrderTarget),
        revenueTarget: Math.round(dailyRevenueTarget),
        cumOrderTarget: Math.round(cumOrderTarget),
        cumRevenueTarget: Math.round(cumRevenueTarget),
        isPast: dateISO <= todayISO,
        isWeekStart
      })
    }

    // Контрольные периоды для трекера
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const weekStartISO = weekStart.toISOString().slice(0, 10)

    const monthStartISO = `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-01`

    const qStartMonth = Math.floor(todayMonth / 3) * 3
    const qStartISO = `${todayYear}-${String(qStartMonth + 1).padStart(2, '0')}-01`

    const yearStartISO = `${todayYear}-01-01`

    return {
      monthly,
      quarterly,
      planFactDaily,
      targets: {
        day: { ordersTarget: Math.round(dailyOrderTarget), revenueTarget: Math.round(dailyRevenueTarget), leadsTarget: Math.round(dailyOrderTarget / (targetConversion || 0.5)), mktBudgetTarget: Math.round(dailyRevenueTarget * 0.166) },
        week: { ordersTarget: Math.round(dailyOrderTarget * 5), revenueTarget: Math.round(dailyRevenueTarget * 5), leadsTarget: Math.round(dailyOrderTarget * 5 / (targetConversion || 0.5)), mktBudgetTarget: Math.round(dailyRevenueTarget * 5 * 0.166) },
        month: { ordersTarget: curMonth.ordersTarget, revenueTarget: curMonth.revenueTarget, leadsTarget: curMonth.leadsTarget, mktBudgetTarget: Math.round(curMonth.revenueTarget * 0.166) },
        quarter: { ordersTarget: quarterly[Math.floor(todayMonth / 3)].ordersTarget, revenueTarget: quarterly[Math.floor(todayMonth / 3)].revenueTarget },
        year: { ordersTarget: yearOrders, revenueTarget: yearRevenue }
      },
      dateRanges: { day: { from: todayISO, to: todayISO }, week: { from: weekStartISO, to: todayISO }, month: { from: monthStartISO, to: todayISO }, quarter: { from: qStartISO, to: todayISO }, year: { from: yearStartISO, to: todayISO } }
    }
  }

  const compute = (rawData, filters) => {
    const from = parseISO(filters.dateFrom)
    const to = parseISO(filters.dateTo)

    const txns = (rawData.transactions || []).filter((r) => inRange(r.date, from, to))
    const mktDaily = (rawData.marketingDaily || []).filter((r) => inRange(r.date, from, to))
    const managersMap = {}
    ;(rawData.managers || []).forEach((m) => { managersMap[m.id] = m.name })

    // --- 6-этапная воронка ---
    const mktLeads = mktDaily.reduce((s, r) => s + (r.leads || 0), 0)
    const mktSpend = mktDaily.reduce((s, r) => s + (r.spend || 0), 0)

    const stageOrder = ['lead', 'contact', 'dialog', 'deal', 'payment']
    const stageCounts = { lead: 0, contact: 0, dialog: 0, deal: 0, payment: 0 }
    const stageRevenue = { lead: 0, contact: 0, dialog: 0, deal: 0, payment: 0 }

    txns.forEach((t) => {
      const s = t.funnelStage
      if (stageCounts[s] !== undefined) {
        stageCounts[s]++
        stageRevenue[s] += t.amount || 0
      }
    })

    const ordersCount = stageCounts.deal + stageCounts.payment
    const paymentsRevenue = txns.filter((t) => t.funnelStage === 'payment' && t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0)
    const totalRevenue = txns.filter((t) => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0)

    // Обращения = все транзакции на стадии lead + contact (первичные контакты) + mktLeads
    // Логика: маркетинг генерирует лидов, из них попадают в CRM
    const allLeads = Math.max(mktLeads, stageCounts.lead + stageCounts.contact + stageCounts.dialog + stageCounts.deal + stageCounts.payment)
    const qualifiedLeads = stageCounts.contact + stageCounts.dialog + stageCounts.deal + stageCounts.payment
    const dealsAndPayments = stageCounts.deal + stageCounts.payment
    const paidPayments = stageCounts.payment

    const funnel6 = [
      { stage: 'marketing', label: 'Маркетинг', sublabel: `Бюджет: ${fmtMoney(mktSpend)}`, count: Math.round(mktLeads), amount: mktSpend, convFrom: null },
      { stage: 'leads', label: 'Обращения', sublabel: 'Все контакты', count: allLeads, amount: 0, convFrom: mktLeads > 0 ? pct(allLeads, mktLeads) : null },
      { stage: 'qualify', label: 'Квалификация', sublabel: 'Заинтересованы', count: qualifiedLeads, amount: 0, convFrom: allLeads > 0 ? pct(qualifiedLeads, allLeads) : null },
      { stage: 'orders', label: 'Заказы', sublabel: 'Оформлено', count: dealsAndPayments, amount: stageRevenue.deal + stageRevenue.payment, convFrom: qualifiedLeads > 0 ? pct(dealsAndPayments, qualifiedLeads) : null },
      { stage: 'payments', label: 'Оплаты', sublabel: 'Получено', count: paidPayments, amount: paymentsRevenue, convFrom: dealsAndPayments > 0 ? pct(paidPayments, dealsAndPayments) : null },
      { stage: 'finance', label: 'Финансы', sublabel: 'Выручка', count: null, amount: totalRevenue, convFrom: null }
    ]

    // --- KPI карточки ---
    const planParams = loadPlanParams(rawData)
    const decomp = decompPlan(planParams)
    const today = new Date()
    const todayISO = today.toISOString().slice(0, 10)
    const monthISO = todayISO.slice(0, 7)

    const monthTxns = txns.filter((t) => t.date.startsWith(monthISO))
    const monthOrders = monthTxns.filter((t) => t.funnelStage === 'payment' || t.funnelStage === 'deal').length
    const monthRevenue = monthTxns.filter((t) => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0)
    const monthAvgCheck = monthOrders > 0 ? monthRevenue / monthOrders : 0
    const totalTxnsInPeriod = txns.length
    const monthConversion = mktLeads > 0 ? pct(paidPayments, mktLeads) : 0

    // Новые клиенты в периоде — те, кто впервые появился в периоде
    const clientFirstSeen = {}
    ;(rawData.transactions || []).forEach((t) => {
      if (!clientFirstSeen[t.clientId] || t.date < clientFirstSeen[t.clientId]) {
        clientFirstSeen[t.clientId] = t.date
      }
    })
    const newClientsInPeriod = new Set(txns.filter((t) => clientFirstSeen[t.clientId] >= filters.dateFrom).map((t) => t.clientId)).size

    const mPlan = decomp.targets.month

    const kpiCards = {
      ordersMonth: { fact: monthOrders, plan: mPlan.ordersTarget, pct: pct(monthOrders, mPlan.ordersTarget) },
      revenueMonth: { fact: monthRevenue, plan: mPlan.revenueTarget, pct: pct(monthRevenue, mPlan.revenueTarget) },
      avgCheck: { fact: monthAvgCheck, plan: planParams.targetAvgCheck },
      conversionRate: { value: monthConversion, plan: Math.round((planParams.targetConversion || 0.529) * 1000) / 10 },
      newClients: { count: newClientsInPeriod, plan: Math.round(mPlan.ordersTarget * (planParams.targetConversion || 0.5) * 0.3) }
    }

    // --- Расширенная таблица менеджеров ---
    const mgrStats = {}
    txns.forEach((t) => {
      const mid = t.managerId
      if (!mgrStats[mid]) {
        mgrStats[mid] = { name: managersMap[mid] || mid, leads: 0, orders: 0, revenue: 0, missedCalls: 0, rejections: 0, callbacks: 0, totalAmount: 0 }
      }
      const s = mgrStats[mid]
      s.leads++
      if (t.funnelStage === 'deal' || t.funnelStage === 'payment') {
        s.orders++
        s.revenue += t.amount || 0
      }
      if (t.status === 'lost' && t.rejectionReason === 'Не отвечает') s.missedCalls++
      else if (t.status === 'lost') s.rejections++
      if (t.isCallback) s.callbacks++
    })

    const managerExtended = Object.values(mgrStats).map((m) => ({
      ...m,
      conversion: pct(m.orders, m.leads),
      avgCheck: m.orders > 0 ? Math.round(m.revenue / m.orders) : 0,
      callbackPct: pct(m.callbacks, m.leads)
    })).sort((a, b) => b.revenue - a.revenue)

    // --- Таблица каналов/источников ---
    const channelSpend = {}
    mktDaily.forEach((r) => {
      const slug = slugify(r.channelLabel || r.channel)
      if (!channelSpend[slug]) channelSpend[slug] = { label: r.channelLabel || r.channel, spend: 0, leads: 0 }
      channelSpend[slug].spend += r.spend || 0
      channelSpend[slug].leads += r.leads || 0
    })

    const srcStats = {}
    txns.forEach((t) => {
      const slug = slugify(t.source)
      const label = t.source || '—'
      if (!srcStats[slug]) srcStats[slug] = { label, leads: 0, orders: 0, revenue: 0 }
      srcStats[slug].leads++
      if (t.funnelStage === 'deal' || t.funnelStage === 'payment') {
        srcStats[slug].orders++
        srcStats[slug].revenue += t.amount || 0
      }
    })

    const channelTable = Object.entries(srcStats).map(([slug, s]) => {
      const mkt = channelSpend[slug] || { spend: 0 }
      const cac = s.orders > 0 && mkt.spend > 0 ? Math.round(mkt.spend / s.orders) : null
      return {
        label: s.label,
        leads: s.leads,
        orders: s.orders,
        conversion: pct(s.orders, s.leads),
        amount: s.revenue,
        avgCheck: s.orders > 0 ? Math.round(s.revenue / s.orders) : 0,
        cac
      }
    }).sort((a, b) => b.orders - a.orders)

    // --- Новые vs Повторные ---
    const newSet = new Set(txns.filter((t) => clientFirstSeen[t.clientId] >= filters.dateFrom).map((t) => t.clientId))
    let newRev = 0, newOrders = 0, repeatRev = 0, repeatOrders = 0
    txns.forEach((t) => {
      if (t.funnelStage !== 'payment' || t.status !== 'paid') return
      if (newSet.has(t.clientId)) { newRev += t.amount || 0; newOrders++ }
      else { repeatRev += t.amount || 0; repeatOrders++ }
    })
    const blendedCAC = (newOrders + repeatOrders) > 0 ? Math.round(mktSpend / (newOrders + repeatOrders)) : 0
    const newVsRepeat = {
      new: { count: newOrders, revenue: newRev, avgCheck: newOrders > 0 ? Math.round(newRev / newOrders) : 0 },
      repeat: { count: repeatOrders, revenue: repeatRev, avgCheck: repeatOrders > 0 ? Math.round(repeatRev / repeatOrders) : 0 },
      blendedCAC
    }

    // --- Причины отказов ---
    const rejMap = {}
    txns.filter((t) => t.status === 'lost').forEach((t) => {
      const r = t.rejectionReason || 'Другое'
      if (!rejMap[r]) rejMap[r] = 0
      rejMap[r]++
    })
    // Также из rawData.lossReasons если нет в транзакциях
    if (Object.keys(rejMap).length === 0 && rawData.lossReasons) {
      rawData.lossReasons.forEach((lr) => { rejMap[lr.reason] = lr.count })
    }
    const totalRejections = Object.values(rejMap).reduce((s, v) => s + v, 0)
    const rejectionReasons = Object.entries(rejMap)
      .map(([reason, count]) => ({ reason, count, pctOfRejections: pct(count, totalRejections) }))
      .sort((a, b) => b.count - a.count)

    // --- Прогресс трекер — факт по каждому периоду ---
    const periodFact = (from, to) => {
      const f = parseISO(from), t2 = parseISO(to)
      const rows = (rawData.transactions || []).filter((r) => inRange(r.date, f, t2))
      const orders = rows.filter((r) => r.funnelStage === 'payment' || r.funnelStage === 'deal').length
      const revenue = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0)
      return { orders, revenue }
    }

    const dr = decomp.dateRanges
    const progressTracker = [
      { label: 'Сегодня', ...decomp.targets.day, ...periodFact(dr.day.from, dr.day.to) },
      { label: 'Эта неделя', ...decomp.targets.week, ...periodFact(dr.week.from, dr.week.to) },
      { label: 'Этот месяц', ...decomp.targets.month, ...periodFact(dr.month.from, dr.month.to) },
      { label: 'Этот квартал', ...decomp.targets.quarter, ...periodFact(dr.quarter.from, dr.quarter.to) },
      { label: 'Этот год', ...decomp.targets.year, ...periodFact(dr.year.from, dr.year.to) }
    ].map((row) => ({
      ...row,
      orderPct: pct(row.orders, row.ordersTarget),
      revenuePct: pct(row.revenue, row.revenueTarget)
    }))

    // --- План/Факт по дням с недельными сабтоталами ---
    const planFactFull = []
    let weekOrderFact = 0, weekRevenueFact = 0, weekOrderTarget = 0, weekRevenueTarget = 0
    const txnByDate = {}
    txns.forEach((t) => {
      if (!txnByDate[t.date]) txnByDate[t.date] = []
      txnByDate[t.date].push(t)
    })

    decomp.planFactDaily.forEach((row, i) => {
      const dayTxns = txnByDate[row.date] || []
      const dayOrderFact = dayTxns.filter((t) => t.funnelStage === 'payment' || t.funnelStage === 'deal').length
      const dayRevenueFact = dayTxns.filter((t) => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0)

      weekOrderFact += dayOrderFact
      weekRevenueFact += dayRevenueFact
      weekOrderTarget += row.orderTarget
      weekRevenueTarget += row.revenueTarget

      planFactFull.push({ ...row, orderFact: dayOrderFact, revenueFact: dayRevenueFact, delta: dayOrderFact - row.orderTarget })

      const isLastDayOfWeek = (i + 1) % 7 === 0 || i === decomp.planFactDaily.length - 1
      if (isLastDayOfWeek) {
        const weekNum = Math.floor(i / 7) + 1
        planFactFull.push({
          date: `Неделя ${weekNum}`,
          day: null,
          isWeekSubtotal: true,
          orderTarget: weekOrderTarget,
          orderFact: weekOrderFact,
          revenueTarget: weekRevenueTarget,
          revenueFact: weekRevenueFact,
          cumOrderTarget: row.cumOrderTarget,
          cumRevenueFact: 0
        })
        weekOrderFact = 0; weekRevenueFact = 0; weekOrderTarget = 0; weekRevenueTarget = 0
      }
    })

    return { funnel6, kpiCards, managerExtended, channelTable, newVsRepeat, rejectionReasons, progressTracker, planFactFull, planParams, decomp }
  }

  global.SalesFunnel = { compute, loadPlanParams, decompPlan }
})(typeof window !== 'undefined' ? window : globalThis)
