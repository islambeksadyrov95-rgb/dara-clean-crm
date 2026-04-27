;(function (global) {
  const MS_DAY = 86400000

  /** Поля разбивки 2GIS из marketingDaily (см. etl/two_gis_connections.py) */
  const TWO_GIS_METRIC_KEYS = [
    'twoGisCallsPhoneViews',
    'twoGisAddressClicks',
    'twoGisWebsiteVisits',
    'twoGisRouteBuilds',
    'twoGisSocialClicks',
    'twoGisMessengerClicks',
    'twoGisAdLinkClicks'
  ]

  const parseISODate = (iso) => new Date(iso + 'T12:00:00').getTime()

  const inRange = (iso, from, to) => {
    const t = parseISODate(iso)
    return t >= from && t <= to
  }

  const startOfWeekMonday = (ts) => {
    const d = new Date(ts)
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  const bucketKey = (iso, granularity) => {
    const t = parseISODate(iso)
    if (granularity === 'day') return iso
    if (granularity === 'week') {
      const w = startOfWeekMonday(t)
      return new Date(w).toISOString().slice(0, 10)
    }
    return iso.slice(0, 7)
  }

  const filterRows = (rows, filters, data) => {
    const from = parseISODate(filters.dateFrom)
    const to = parseISODate(filters.dateTo)
    return rows.filter((r) => {
      if (!inRange(r.date, from, to)) return false
      if (filters.managerId && r.managerId !== filters.managerId) return false
      if (filters.clientId && r.clientId !== filters.clientId) return false
      if (filters.productId && r.productId !== filters.productId) return false
      return true
    })
  }

  const sum = (arr, pick) => arr.reduce((s, x) => s + pick(x), 0)

  const classifyABC = (items, valueKey) => {
    const sorted = [...items].sort((a, b) => b[valueKey] - a[valueKey])
    const total = sum(sorted, (x) => x[valueKey]) || 1
    let cum = 0
    return sorted.map((x) => {
      cum += x[valueKey]
      const cumShare = cum / total
      let cls = 'C'
      if (cumShare <= 0.8) cls = 'A'
      else if (cumShare <= 0.95) cls = 'B'
      return { ...x, abc: cls, revenueShare: x[valueKey] / total }
    })
  }

  const stdev = (vals) => {
    if (!vals.length) return 0
    const m = vals.reduce((a, b) => a + b, 0) / vals.length
    const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length
    return Math.sqrt(v)
  }

  const classifyXYZ = (productMonthly, productId) => {
    const vals = productMonthly[productId] || []
    if (!vals.length) return 'Z'
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length || 1
    const cv = stdev(vals) / mean
    if (cv < 0.25) return 'X'
    if (cv < 0.5) return 'Y'
    return 'Z'
  }

  const buildProductMonthly = (transactions) => {
    const map = {}
    transactions.forEach((t) => {
      if (t.status === 'lost') return
      const mk = monthKey(t.date)
      const k = t.productId
      if (!map[k]) map[k] = {}
      map[k][mk] = (map[k][mk] || 0) + t.amount
    })
    const out = {}
    Object.keys(map).forEach((pid) => {
      out[pid] = Object.keys(map[pid]).sort().map((m) => map[pid][m])
    })
    return out
  }

  const monthKey = (iso) => iso.slice(0, 7)

  const trafficLight = (pct) => {
    if (pct >= 100) return 'good'
    if (pct >= 85) return 'warn'
    return 'bad'
  }

  const compute = (raw, filters) => {
    const granularity = filters.granularity || 'day'
    const trans = filterRows(raw.transactions, filters, raw)
    const clientsById = Object.fromEntries(raw.clients.map((c) => [c.id, c]))
    const productsById = Object.fromEntries(raw.products.map((p) => [p.id, p]))
    const managersById = Object.fromEntries(raw.managers.map((m) => [m.id, m]))

    const from = parseISODate(filters.dateFrom)
    const to = parseISODate(filters.dateTo)
    const rangeDays = Math.max(1, Math.round((to - from) / MS_DAY) + 1)

    const factPaid = trans.filter((t) => t.status === 'paid')
    const clientName0 = String(raw.clients?.[0]?.name || '')
    const lonePlaceholderMgr =
      raw.managers?.length === 1 &&
      /^[\s\u2014\u2013\-—]{1,3}$/.test(String(raw.managers[0]?.name || '').trim())
    const isBaseAggregate =
      !!raw.meta?.salesPivotSynthesized ||
      (raw.clients?.length === 1 && /агрегат/i.test(clientName0)) ||
      (raw.clients?.length === 1 && lonePlaceholderMgr && factPaid.length > 3)
    const factRevenue = sum(factPaid, (t) => t.amount)
    const planFromRows = sum(trans, (t) => t.planAmount)
    const dailyPlanMap = Object.fromEntries((raw.plans.daily || []).map((d) => [d.date, d.amount]))
    const hasDailyPlan = Object.keys(dailyPlanMap).length > 0
    let planTotal = 0
    if (hasDailyPlan) {
      for (let tt = from; tt <= to; tt += MS_DAY) {
        const iso = new Date(tt).toISOString().slice(0, 10)
        planTotal += dailyPlanMap[iso] ?? 0
      }
    } else {
      planTotal = planFromRows
    }
    const hasPlanTotal = planTotal > 0
    const planFactPct = hasPlanTotal ? (factRevenue / planTotal) * 100 : null

    const tsMap = {}
    factPaid.forEach((t) => {
      const k = bucketKey(t.date, granularity)
      tsMap[k] = (tsMap[k] || 0) + t.amount
    })
    const tsLabels = Object.keys(tsMap).sort()
    const tsValues = tsLabels.map((k) => tsMap[k])

    const byProduct = {}
    factPaid.forEach((t) => {
      if (!byProduct[t.productId]) {
        byProduct[t.productId] = { productId: t.productId, fact: 0, plan: 0, name: productsById[t.productId]?.name }
      }
      byProduct[t.productId].fact += t.amount
      byProduct[t.productId].plan += t.planAmount
    })
    const productList = Object.values(byProduct).map((p) => ({
      ...p,
      name: p.name || productsById[p.productId]?.name || p.productId
    }))
    const productRevenue = classifyABC(productList.map((p) => ({ ...p, value: p.fact })), 'value').map((x) => {
      const { value, ...rest } = x
      return { ...rest, fact: value }
    })

    const productMonthlyAll = buildProductMonthly(raw.transactions)
    const productXYZ = {}
    raw.products.forEach((p) => {
      productXYZ[p.id] = classifyXYZ(productMonthlyAll, p.id)
    })

    const matrix = {}
    productRevenue.forEach((p) => {
      const xyz = productXYZ[p.productId] || 'Z'
      const key = `${p.abc}${xyz}`
      matrix[key] = (matrix[key] || 0) + 1
    })

    const byClient = {}
    factPaid.forEach((t) => {
      if (!byClient[t.clientId]) {
        byClient[t.clientId] = {
          clientId: t.clientId,
          name: clientsById[t.clientId]?.name,
          fact: 0,
          plan: 0
        }
      }
      byClient[t.clientId].fact += t.amount
      byClient[t.clientId].plan += t.planAmount
    })
    const clientList = Object.values(byClient).sort((a, b) => b.fact - a.fact)
    const topClients = clientList.slice(0, 10)

    const clientMonth = {}
    factPaid.forEach((t) => {
      const m = monthKey(t.date)
      if (!clientMonth[m]) clientMonth[m] = 0
      clientMonth[m] += t.amount
    })
    const clientMonthLabels = Object.keys(clientMonth).sort()
    const clientMonthValues = clientMonthLabels.map((k) => clientMonth[k])

    const byManager = {}
    factPaid.forEach((t) => {
      if (!byManager[t.managerId]) {
        byManager[t.managerId] = {
          managerId: t.managerId,
          name: managersById[t.managerId]?.name,
          revenue: 0,
          plan: 0,
          clients: new Set(),
          txCount: 0
        }
      }
      byManager[t.managerId].revenue += t.amount
      byManager[t.managerId].plan += t.planAmount
      byManager[t.managerId].clients.add(t.clientId)
      byManager[t.managerId].txCount += 1
    })
    const managerRows = Object.values(byManager).map((m) => {
      const cnt = m.clients.size
      const nOrd = m.txCount
      const denom = isBaseAggregate ? nOrd : cnt
      const avgCheck = denom ? m.revenue / denom : 0
      const pct = m.plan > 0 ? (m.revenue / m.plan) * 100 : null
      return {
        managerId: m.managerId,
        name: m.name,
        revenue: m.revenue,
        plan: m.plan,
        clients: isBaseAggregate ? nOrd : cnt,
        avgCheck,
        planPct: pct,
        light: pct == null ? 'warn' : trafficLight(pct)
      }
    })
    managerRows.sort((a, b) => b.revenue - a.revenue)

    const inactiveThreshold = 90 * MS_DAY
    const now = to
    const active = new Set()
    const lastPurchase = {}
    raw.transactions.filter((t) => t.status === 'paid').forEach((t) => {
      const ts = parseISODate(t.date)
      if (!lastPurchase[t.clientId] || ts > lastPurchase[t.clientId]) lastPurchase[t.clientId] = ts
    })
    Object.keys(lastPurchase).forEach((cid) => {
      if (now - lastPurchase[cid] <= inactiveThreshold) active.add(cid)
    })
    const newClients = new Set()
    raw.transactions.filter((t) => t.status === 'paid').forEach((t) => {
      if (!inRange(t.date, from, to)) return
      const cid = t.clientId
      const first = raw.transactions
        .filter((x) => x.clientId === cid && x.status === 'paid')
        .map((x) => parseISODate(x.date))
        .sort((a, b) => a - b)[0]
      if (first && first >= from && first <= to) newClients.add(cid)
    })
    const hadBefore = new Set()
    raw.transactions
      .filter((t) => t.status === 'paid' && parseISODate(t.date) < from)
      .forEach((t) => hadBefore.add(t.clientId))
    const lostClients = new Set()
    hadBefore.forEach((cid) => {
      const boughtInRange = raw.transactions.some(
        (t) => t.clientId === cid && t.status === 'paid' && inRange(t.date, from, to)
      )
      if (!boughtInRange) lostClients.add(cid)
    })

    const clientRevenueLifetime = {}
    raw.transactions
      .filter((t) => t.status === 'paid')
      .forEach((t) => {
        clientRevenueLifetime[t.clientId] = (clientRevenueLifetime[t.clientId] || 0) + t.amount
      })
    const lifetimes = {}
    raw.clients.forEach((c) => {
      const dates = raw.transactions
        .filter((t) => t.clientId === c.id && t.status === 'paid')
        .map((t) => parseISODate(t.date))
        .sort((a, b) => a - b)
      if (dates.length) {
        lifetimes[c.id] = (dates[dates.length - 1] - dates[0]) / MS_DAY
      } else {
        lifetimes[c.id] = 0
      }
    })
    const nClients = Object.keys(clientRevenueLifetime).length || 1
    const totalLtv = Object.values(clientRevenueLifetime).reduce((a, b) => a + b, 0)
    const avgLifetimeDaysPerClient =
      Object.values(lifetimes).reduce((a, b) => a + b, 0) / (Object.keys(lifetimes).length || 1)
    const avgCheckGlobal = factPaid.length ? factRevenue / factPaid.length : 0
    const avgRevPerClientMonthNorm =
      avgLifetimeDaysPerClient > 0
        ? totalLtv / nClients / (avgLifetimeDaysPerClient / 30)
        : totalLtv / nClients

    const isLtvAggregate = isBaseAggregate

    const monthsInFilter = Math.max(rangeDays / 30, 1e-6)
    let ltvMean, avgLifetimeDays, avgRevPerClientMonth, ltvCardKind
    if (isLtvAggregate) {
      ltvMean = null
      avgLifetimeDays = rangeDays
      avgRevPerClientMonth = factRevenue / monthsInFilter
      ltvCardKind = 'aggregate'
    } else {
      ltvMean = totalLtv / nClients
      avgLifetimeDays = avgLifetimeDaysPerClient
      avgRevPerClientMonth = avgRevPerClientMonthNorm
      ltvCardKind = 'perClient'
    }

    const clientAgg = Object.entries(clientRevenueLifetime).map(([id, rev]) => ({
      clientId: id,
      name: clientsById[id]?.name,
      rev,
      lifetime: lifetimes[id] || 0
    }))
    const abcClients = classifyABC(clientAgg.map((c) => ({ ...c, value: c.rev })), 'value').map((x) => {
      const { value, ...rest } = x
      return { ...rest, rev: value }
    })
    const cvByClient = {}
    raw.clients.forEach((c) => {
      const months = {}
      raw.transactions
        .filter((t) => t.clientId === c.id && t.status === 'paid')
        .forEach((t) => {
          const m = monthKey(t.date)
          months[m] = (months[m] || 0) + t.amount
        })
      const series = Object.keys(months)
        .sort()
        .map((k) => months[k])
      cvByClient[c.id] = series.length ? stdev(series) / (series.reduce((a, b) => a + b, 0) / series.length || 1) : 1
    })
    const clientXYZ = {}
    raw.clients.forEach((c) => {
      const cv = cvByClient[c.id] || 1
      clientXYZ[c.id] = cv < 0.3 ? 'X' : cv < 0.6 ? 'Y' : 'Z'
    })

    const funnelOrder = raw.funnelStages || ['lead', 'contact', 'dialog', 'deal', 'payment']
    const funnelCounts = {}
    funnelOrder.forEach((s) => {
      funnelCounts[s] = 0
    })
    trans.forEach((t) => {
      if (funnelCounts[t.funnelStage] !== undefined) funnelCounts[t.funnelStage] += 1
    })
    const funnelPlan = raw.plans.funnel || {}
    const funnelRow = funnelOrder.map((stage) => ({
      stage,
      fact: funnelCounts[stage],
      plan: funnelPlan[stage] ? funnelPlan[stage] / 30 : funnelCounts[stage] * 1.05
    }))
    const funnelConv = []
    for (let i = 0; i < funnelRow.length - 1; i++) {
      const a = funnelRow[i].fact || 1
      const b = funnelRow[i + 1].fact
      funnelConv.push({ from: funnelRow[i].stage, to: funnelRow[i + 1].stage, rate: (b / a) * 100, loss: a - b })
    }

    const lostLeads = trans.filter((t) => t.status === 'lost' && t.funnelStage !== 'payment').length
    const lostLeadValue = trans.filter((t) => t.status === 'lost').reduce((s, t) => s + t.amount * 0.3, 0)
    const lostClientValue = [...lostClients].reduce((s, cid) => s + (clientRevenueLifetime[cid] || 0) * 0.15, 0)
    const unpaid = trans.filter((t) => t.status === 'unpaid')
    const unpaidSum = sum(unpaid, (t) => t.amount)

    const orderCountByClient = {}
    factPaid.forEach((t) => {
      orderCountByClient[t.clientId] = (orderCountByClient[t.clientId] || 0) + 1
    })
    const categories = {
      one: 0,
      rare: 0,
      periodic: 0,
      regular: 0,
      loyal: 0
    }
    const b2b = { one: 0, rare: 0, periodic: 0, regular: 0, loyal: 0 }
    const b2c = { one: 0, rare: 0, periodic: 0, regular: 0, loyal: 0 }
    Object.keys(orderCountByClient).forEach((cid) => {
      const n = orderCountByClient[cid]
      let cat = 'one'
      if (n >= 12) cat = 'loyal'
      else if (n >= 6) cat = 'regular'
      else if (n >= 3) cat = 'periodic'
      else if (n === 2) cat = 'rare'
      categories[cat] += 1
      const seg = clientsById[cid]?.segment === 'B2B' ? b2b : b2c
      seg[cat] += 1
    })

    const marketingFiltered = (raw.marketingDaily || []).filter((m) => inRange(m.date, from, to))
    const mktByChannel = {}
    marketingFiltered.forEach((m) => {
      const spendCur = m.spendCurrency || 'KZT'
      if (!mktByChannel[m.channel]) {
        mktByChannel[m.channel] = {
          channel: m.channel,
          label: m.channelLabel || m.channel,
          spend: 0,
          spendCurrency: spendCur,
          leads: 0,
          clicks: 0,
          contactsAfterSale: 0,
          applicationsOut: 0
        }
      }
      const ch = mktByChannel[m.channel]
      ch.spend += m.spend
      ch.leads += m.leads
      ch.clicks += m.clicks
      ch.contactsAfterSale += m.contactsAfterSale || 0
      ch.applicationsOut += m.applicationsOut || 0
    })
    const mktChannels = Object.values(mktByChannel)

    const mktDailyMap = {}
    marketingFiltered.forEach((m) => {
      if (!mktDailyMap[m.date]) {
        const twoGisZero = {}
        TWO_GIS_METRIC_KEYS.forEach((k) => {
          twoGisZero[k] = 0
        })
        mktDailyMap[m.date] = {
          date: m.date,
          spendKzt: 0,
          spendUsd: 0,
          spendRub: 0,
          clicks2gis: 0,
          clicksGoogle: 0,
          clicksYandex: 0,
          leads: 0,
          contactsAfterSale: 0,
          applicationsOut: 0,
          ...twoGisZero
        }
      }
      const row = mktDailyMap[m.date]
      const cur = m.spendCurrency || 'KZT'
      if (cur === 'USD') row.spendUsd += m.spend
      else if (cur === 'RUB') row.spendRub += m.spend
      else row.spendKzt += m.spend
      if (m.channel === '2gis') {
        row.clicks2gis += m.clicks || 0
        TWO_GIS_METRIC_KEYS.forEach((k) => {
          row[k] += m[k] || 0
        })
      } else if (m.channel === 'google') row.clicksGoogle += m.clicks || 0
      else if (m.channel === 'yandex') row.clicksYandex += m.clicks || 0
      row.leads += m.leads
      row.contactsAfterSale += m.contactsAfterSale || 0
      row.applicationsOut += m.applicationsOut || 0
    })
    const mktDaily = Object.keys(mktDailyMap)
      .sort()
      .map((d) => {
        const row = mktDailyMap[d]
        return {
          ...row,
          spendKztMarketingTotal: row.spendKzt || 0
        }
      })

    const mktMonthlyMap = {}
    marketingFiltered.forEach((m) => {
      const ym = String(m.date || '').slice(0, 7)
      if (ym.length !== 7) return
      if (!mktMonthlyMap[ym]) {
        mktMonthlyMap[ym] = { month: ym, spendKzt: 0, spendUsd: 0, spendRub: 0 }
      }
      const mo = mktMonthlyMap[ym]
      const cur = m.spendCurrency || 'KZT'
      if (cur === 'USD') mo.spendUsd += m.spend || 0
      else if (cur === 'RUB') mo.spendRub += m.spend || 0
      else mo.spendKzt += m.spend || 0
    })
    const mktMonthly = Object.keys(mktMonthlyMap)
      .sort()
      .map((k) => mktMonthlyMap[k])

    const ymFrom = filters.dateFrom.slice(0, 7)
    const ymTo = filters.dateTo.slice(0, 7)
    const ymInFilter = (ym) => ym >= ymFrom && ym <= ymTo

    const ddsReportsChart = (raw.dds || []).map((rep) => {
      const inc = (rep.incomeItogo && rep.incomeItogo.byMonth) || {}
      const exp = (rep.expenseItogo && rep.expenseItogo.byMonth) || {}
      const allKeys = [...new Set([...Object.keys(inc), ...Object.keys(exp)])].sort()
      let monthKeys = allKeys.filter(ymInFilter)
      if (!monthKeys.length) monthKeys = allKeys
      const incomeByMonth = monthKeys.map((k) => Number(inc[k]) || 0)
      const expenseByMonth = monthKeys.map((k) => Number(exp[k]) || 0)
      const monLabels = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
      return {
        year: rep.year,
        sheet: rep.sheet,
        monthKeys,
        monthLabels: monthKeys.map((k) => {
          const m = parseInt(k.slice(5, 7), 10)
          const y = k.slice(0, 4)
          return `${monLabels[m - 1] || m} ${y}`
        }),
        incomeByMonth,
        expenseByMonth,
        netByMonth: monthKeys.map((_, i) => incomeByMonth[i] - expenseByMonth[i]),
        topExpenseRows: [...(rep.expenseRows || [])]
          .sort((a, b) => (b.total || 0) - (a.total || 0))
          .slice(0, 18),
        incomeGrand: rep.incomeItogo ? rep.incomeItogo.total : null,
        expenseGrand: rep.expenseItogo ? rep.expenseItogo.total : null
      }
    })

    const payrollFiltered = (raw.financePayrollDaily || []).filter(
      (p) => p.date && inRange(p.date, from, to)
    )
    const payrollTotal = payrollFiltered.reduce((s, p) => s + (Number(p.amount) || 0), 0)

    const funnelSnapFiltered = (raw.funnelSnapshots || []).filter((f) => inRange(f.date, from, to))
    const funnelDaily = funnelSnapFiltered.length
      ? funnelSnapFiltered
      : []

    return {
      kpi: {
        fact: factRevenue,
        plan: planTotal,
        pct: planFactPct,
        hasPlan: hasPlanTotal,
        light: planFactPct == null ? 'warn' : trafficLight(planFactPct)
      },
      timeSeries: { labels: tsLabels, values: tsValues },
      products: {
        rows: productRevenue.map((p) => ({
          ...p,
          xyz: productXYZ[p.productId],
          planPct: p.plan > 0 ? (p.fact / p.plan) * 100 : null
        })),
        matrix,
        productXYZ
      },
      clients: {
        rows: clientList,
        top: topClients,
        monthly: { labels: clientMonthLabels, values: clientMonthValues }
      },
      managers: managerRows,
      base: (() => {
        if (isBaseAggregate) {
          const paidDayKeys = [...new Set(factPaid.map((t) => String(t.date).slice(0, 10)))]
          const uniqDays = paidDayKeys.length
          const lostInPeriod = trans.filter((t) => t.status === 'lost').length
          const unpaidInPeriod = trans.filter((t) => t.status === 'unpaid').length
          return {
            aggregate: true,
            active: factPaid.length,
            inactive: uniqDays,
            new: uniqDays ? Math.round((factPaid.length / uniqDays) * 10) / 10 : 0,
            lost: lostInPeriod + unpaidInPeriod
          }
        }
        return {
          aggregate: false,
          active: active.size,
          inactive: raw.clients.length - active.size,
          new: newClients.size,
          lost: lostClients.size
        }
      })(),
      ltv: {
        aggregate: isLtvAggregate,
        ltvCardKind,
        ltv: ltvMean,
        avgCheck: avgCheckGlobal,
        avgLifeDays: avgLifetimeDays,
        avgRevPerClientMonth: avgRevPerClientMonth,
        clientABC: abcClients,
        clientXYZMap: clientXYZ
      },
      funnel: { rows: funnelRow, conversions: funnelConv },
      categories: { totals: categories, b2b, b2c },
      losses: {
        lostLeads,
        lostLeadValue,
        lostClients: lostClients.size,
        lostClientValue,
        unpaid: unpaid.length,
        unpaidSum,
        reasons: raw.lossReasons || []
      },
      marketing: {
        channels: mktChannels,
        daily: mktDaily,
        monthly: mktMonthly,
        funnelDaily
      },
      financeDds: {
        hasDds: (raw.dds || []).length > 0,
        reports: ddsReportsChart
      },
      financePayroll: {
        hasPayroll: payrollFiltered.length > 0,
        count: payrollFiltered.length,
        total: payrollTotal,
        rows: [...payrollFiltered].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 90)
      },
      _clientsById: clientsById
    }
  }

  global.DashboardAnalytics = {
    filterRows,
    compute,
    trafficLight,
    bucketKey
  }
})(typeof window !== 'undefined' ? window : globalThis)
