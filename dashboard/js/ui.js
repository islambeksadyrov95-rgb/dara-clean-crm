;(function (global) {
  const chartRegistry = []

  /** Серии графика «маркетинг по дням» — соответствуют колонкам выгрузки 2GIS (connections-daily). */
  const TWO_GIS_DAILY_SERIES = [
    { key: 'twoGisCallsPhoneViews', label: '2GIS: звонки и просмотры телефона', borderColor: '#0ea5e9', borderDash: [6, 4] },
    { key: 'twoGisAddressClicks', label: '2GIS: клики в адрес', borderColor: '#6366f1', borderDash: [5, 3] },
    { key: 'twoGisWebsiteVisits', label: '2GIS: переходы на сайт', borderColor: '#22c55e', borderDash: [3, 3] },
    { key: 'twoGisRouteBuilds', label: '2GIS: построения маршрутов', borderColor: '#eab308', borderDash: [8, 4] },
    { key: 'twoGisSocialClicks', label: '2GIS: клики в соцсети', borderColor: '#f97316', borderDash: [2, 2] },
    { key: 'twoGisMessengerClicks', label: '2GIS: клики в мессенджеры', borderColor: '#ec4899', borderDash: [4, 2] },
    { key: 'twoGisAdLinkClicks', label: '2GIS: переходы по рекламной ссылке', borderColor: '#a855f7', borderDash: [10, 4] }
  ]

  const destroyCharts = () => {
    while (chartRegistry.length) {
      const c = chartRegistry.pop()
      try {
        c.destroy()
      } catch (e) {
        /* ignore */
      }
    }
  }

  const pushChart = (ctx, config) => {
    const chart = new Chart(ctx, config)
    chartRegistry.push(chart)
    return chart
  }

  const formatMoney = (n, currency) => {
    const cur = currency || 'KZT'
    const code = cur === 'USD' ? 'USD' : cur === 'RUB' ? 'RUB' : 'KZT'
    const fd = code === 'KZT' ? 0 : 2
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: code, maximumFractionDigits: fd }).format(n || 0)
  }

  const formatPct = (n) => `${(n || 0).toFixed(1)}%`

  const funnelLabels = {
    lead: 'Лид',
    contact: 'Контакт',
    dialog: 'Диалог',
    deal: 'Сделка',
    payment: 'Оплата'
  }

  const setText = (id, text) => {
    const el = document.getElementById(id)
    if (el) el.textContent = text
  }

  const renderKpi = (meta, kpi) => {
    setText('kpi-fact', formatMoney(kpi.fact, meta.currency))
    setText('kpi-plan', kpi.hasPlan ? formatMoney(kpi.plan, meta.currency) : '—')
    setText('kpi-pct', kpi.pct != null ? formatPct(kpi.pct) : 'н/д')
    const strip = document.getElementById('kpi-strip')
    if (strip) {
      strip.classList.remove('kpi--good', 'kpi--warn', 'kpi--bad')
      strip.classList.add(`kpi--${kpi.light}`)
    }
  }

  const renderTable = (tbodyId, rows, columns) => {
    const tb = document.getElementById(tbodyId)
    if (!tb) return
    tb.innerHTML = ''
    rows.forEach((row) => {
      const tr = document.createElement('tr')
      columns.forEach((col) => {
        const td = document.createElement('td')
        td.textContent = col.format ? col.format(row[col.key], row) : row[col.key]
        tr.appendChild(td)
      })
      if (row._drill) {
        tr.style.cursor = 'pointer'
        tr.title = 'Нажмите для фильтрации'
        tr.addEventListener('click', () => row._drill())
      }
      tb.appendChild(tr)
    })
  }

  const renderAll = (raw, result, filters, handlers) => {
    destroyCharts()
    const meta = raw.meta || { currency: 'RUB' }

    renderKpi(meta, result.kpi)

    const lineCtx = document.getElementById('chart-sales-line')
    if (lineCtx) {
      pushChart(lineCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: result.timeSeries.labels,
          datasets: [
            {
              label: 'Выручка (факт)',
              data: result.timeSeries.values,
              borderColor: '#2563eb',
              backgroundColor: 'rgba(37,99,235,0.15)',
              fill: true,
              tension: 0.25
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            x: { ticks: { maxRotation: 45, minRotation: 0 } },
            y: { beginAtZero: true }
          }
        }
      })
    }

    const prodBarCtx = document.getElementById('chart-products-bar')
    if (prodBarCtx) {
      const rows = result.products.rows.slice(0, 12)
      const showProdPlan = rows.some((r) => (r.plan || 0) > 0)
      const ds = [
        { label: 'Факт', data: rows.map((r) => r.fact), backgroundColor: '#0d9488' }
      ]
      if (showProdPlan) {
        ds.push({ label: 'План', data: rows.map((r) => r.plan), backgroundColor: '#94a3b8' })
      }
      pushChart(prodBarCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: rows.map((r) => r.name),
          datasets: ds
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } },
          scales: { x: { stacked: false }, y: { beginAtZero: true } }
        }
      })
    }

    const abcCtx = document.getElementById('chart-abcxyz-matrix')
    if (abcCtx) {
      const cellLabels = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ']
      const data = cellLabels.map((c) => result.products.matrix[c] || 0)
      pushChart(abcCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: cellLabels,
          datasets: [{ label: 'Кол-во SKU', data, backgroundColor: '#7c3aed' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      })
    }

    renderTable(
      'tbody-products',
      result.products.rows,
      [
        { key: 'name' },
        { key: 'fact', format: (v) => formatMoney(v, meta.currency) },
        {
          key: 'plan',
          format: (v) => ((v || 0) > 0 ? formatMoney(v, meta.currency) : '—')
        },
        { key: 'revenueShare', format: (v) => formatPct((v || 0) * 100) },
        { key: 'abc' },
        { key: 'xyz' },
        {
          key: 'planPct',
          format: (v) => (v == null ? '—' : formatPct(v))
        }
      ]
    )

    const tbClients = document.getElementById('tbody-clients')
    if (tbClients) {
      tbClients.innerHTML = ''
      result.clients.top.forEach((row) => {
        const tr = document.createElement('tr')
        tr.style.cursor = handlers.onDrillClient ? 'pointer' : 'default'
        tr.title = handlers.onDrillClient ? 'Нажмите, чтобы отфильтровать клиента' : ''
        ;['name', 'fact', 'plan'].forEach((k) => {
          const td = document.createElement('td')
          if (k === 'name') td.textContent = row.name || ''
          else if (k === 'plan' && !(row.plan > 0)) td.textContent = '—'
          else td.textContent = formatMoney(row[k], meta.currency)
          tr.appendChild(td)
        })
        if (handlers.onDrillClient) {
          tr.addEventListener('click', () => handlers.onDrillClient(row.clientId))
        }
        tbClients.appendChild(tr)
      })
    }

    const clientsLineCtx = document.getElementById('chart-clients-month')
    if (clientsLineCtx) {
      pushChart(clientsLineCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: result.clients.monthly.labels,
          datasets: [
            {
              label: 'Выручка по месяцам',
              data: result.clients.monthly.values,
              borderColor: '#ea580c',
              tension: 0.2
            }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      })
    }

    const mgrCtx = document.getElementById('chart-managers-bar')
    if (mgrCtx) {
      pushChart(mgrCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: result.managers.map((m) => m.name),
          datasets: [
            { label: 'Выручка', data: result.managers.map((m) => m.revenue), backgroundColor: '#0ea5e9' },
            { label: 'План', data: result.managers.map((m) => m.plan), backgroundColor: '#cbd5e1' }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      })
    }

    renderTable(
      'tbody-managers',
      result.managers,
      [
        { key: 'name' },
        { key: 'revenue', format: (v) => formatMoney(v, meta.currency) },
        { key: 'clients' },
        { key: 'avgCheck', format: (v) => formatMoney(v, meta.currency) },
        { key: 'planPct', format: (v) => (v == null ? '—' : formatPct(v)) }
      ]
    )

    const baseHint = document.getElementById('base-aggregate-hint')
    const baseTitle = document.getElementById('base-section-title')
    const thMgrClients = document.getElementById('th-managers-clients')
    if (result.base.aggregate) {
      if (baseHint) baseHint.hidden = false
      if (baseTitle) baseTitle.textContent = '5. Свод отчёта: строки оплат'
      if (thMgrClients) thMgrClients.textContent = 'Оплат (строк)'
      setText('base-lab-active', 'Строк свода в периоде')
      setText('base-active', String(result.base.active))
      setText('base-lab-inactive', 'Дней с выручкой')
      setText('base-inactive', String(result.base.inactive))
      setText('base-lab-new', 'Среднее строк в день')
      setText('base-new', String(result.base.new))
      setText('base-lab-lost', 'Потери + не оплачено')
      setText('base-lost', String(result.base.lost))
    } else {
      if (baseHint) baseHint.hidden = true
      if (baseTitle) baseTitle.textContent = '5. Клиентская база'
      if (thMgrClients) thMgrClients.textContent = 'Клиенты'
      setText('base-lab-active', 'Активные')
      setText('base-active', String(result.base.active))
      setText('base-lab-inactive', 'Неактивные')
      setText('base-inactive', String(result.base.inactive))
      setText('base-lab-new', 'Новые в периоде')
      setText('base-new', String(result.base.new))
      setText('base-lab-lost', 'Потерянные')
      setText('base-lost', String(result.base.lost))
    }

    const ltvHint = document.getElementById('ltv-aggregate-hint')
    if (ltvHint) ltvHint.hidden = !result.ltv.aggregate
    if (result.ltv.aggregate) {
      setText('ltv-lab-main', 'LTV (на клиента)')
      setText('ltv-value', 'н/д')
      setText('ltv-lab-check', 'Средняя строка свода')
      setText('ltv-check', formatMoney(result.ltv.avgCheck, meta.currency))
      setText('ltv-lab-life', 'Дней в периоде фильтра')
      setText('ltv-life', `${result.ltv.avgLifeDays.toFixed(0)} дн.`)
      setText('ltv-lab-month', 'Выручка в мес (темп)')
      setText('ltv-month', formatMoney(result.ltv.avgRevPerClientMonth, meta.currency))
    } else {
      setText('ltv-lab-main', 'LTV')
      setText('ltv-value', formatMoney(result.ltv.ltv, meta.currency))
      setText('ltv-lab-check', 'Средний чек')
      setText('ltv-check', formatMoney(result.ltv.avgCheck, meta.currency))
      setText('ltv-lab-life', 'Срок жизни (ср.)')
      setText('ltv-life', `${result.ltv.avgLifeDays.toFixed(0)} дн.`)
      setText('ltv-lab-month', 'Выручка / мес на клиента')
      setText('ltv-month', formatMoney(result.ltv.avgRevPerClientMonth, meta.currency))
    }

    renderTable(
      'tbody-ltv-abc',
      result.ltv.clientABC.slice(0, 15),
      [
        { key: 'name' },
        { key: 'rev', format: (v) => formatMoney(v, meta.currency) },
        { key: 'abc' },
        {
          key: 'clientId',
          format: (_v, row) => result.ltv.clientXYZMap[row.clientId] || '—'
        }
      ]
    )

    const funnelCtx = document.getElementById('chart-funnel')
    if (funnelCtx) {
      pushChart(funnelCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: result.funnel.rows.map((r) => funnelLabels[r.stage] || r.stage),
          datasets: [
            { label: 'Факт', data: result.funnel.rows.map((r) => r.fact), backgroundColor: '#16a34a' },
            { label: 'План', data: result.funnel.rows.map((r) => r.plan), backgroundColor: '#a3a3a3' }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      })
    }

    renderTable(
      'tbody-funnel-conv',
      result.funnel.conversions,
      [
        { key: 'from', format: (v) => funnelLabels[v] || v },
        { key: 'to', format: (v) => funnelLabels[v] || v },
        { key: 'rate', format: (v) => formatPct(v) },
        { key: 'loss' }
      ]
    )

    const cat = result.categories.totals
    const catCtx = document.getElementById('chart-categories')
    if (catCtx) {
      pushChart(catCtx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Разовые', 'Редкие', 'Периодич.', 'Регулярн.', 'Постоянные'],
          datasets: [
            {
              data: [cat.one, cat.rare, cat.periodic, cat.regular, cat.loyal],
              backgroundColor: ['#64748b', '#94a3b8', '#38bdf8', '#22c55e', '#a855f7']
            }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      })
    }

    const b2bCtx = document.getElementById('chart-b2b-seg')
    if (b2bCtx) {
      pushChart(b2bCtx.getContext('2d'), {
        type: 'pie',
        data: {
          labels: ['B2B', 'B2C'],
          datasets: [
            {
              data: [
                Object.values(result.categories.b2b).reduce((a, b) => a + b, 0),
                Object.values(result.categories.b2c).reduce((a, b) => a + b, 0)
              ],
              backgroundColor: ['#4f46e5', '#f97316']
            }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      })
    }

    setText('loss-leads', String(result.losses.lostLeads))
    setText('loss-leads-sum', formatMoney(result.losses.lostLeadValue, meta.currency))
    setText('loss-clients', String(result.losses.lostClients))
    setText('loss-clients-sum', formatMoney(result.losses.lostClientValue, meta.currency))
    setText('loss-unpaid', String(result.losses.unpaid))
    setText('loss-unpaid-sum', formatMoney(result.losses.unpaidSum, meta.currency))

    renderTable(
      'tbody-loss-reasons',
      result.losses.reasons,
      [
        { key: 'reason' },
        { key: 'count' },
        { key: 'amount', format: (v) => formatMoney(v, meta.currency) }
      ]
    )

    const monthLabelRu = (ym) => {
      const p = String(ym || '').split('-')
      if (p.length !== 2) return ym
      const y = Number(p[0])
      const mon = Number(p[1])
      if (!y || !mon) return ym
      const dt = new Date(y, mon - 1, 1)
      return dt.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })
    }

    const mktSpendCtx = document.getElementById('chart-mkt-spend')
    const months = result.marketing.monthly || []
    const hasMonthlySpend = months.some(
      (m) => (m.spendKzt || 0) > 0 || (m.spendUsd || 0) > 0 || (m.spendRub || 0) > 0
    )
    if (mktSpendCtx && months.length && hasMonthlySpend) {
      const mkz = months.some((m) => (m.spendKzt || 0) > 0)
      const musd = months.some((m) => (m.spendUsd || 0) > 0)
      const mrub = months.some((m) => (m.spendRub || 0) > 0)
      const usdOnRight = mkz && musd
      const monthlyDs = []
      if (mkz) {
        monthlyDs.push({
          label: 'Расход (₸)',
          data: months.map((m) => m.spendKzt || 0),
          backgroundColor: '#db2777',
          yAxisID: 'yKzt',
          spendCur: 'KZT'
        })
      }
      if (musd) {
        monthlyDs.push({
          label: 'Расход (в валюте $)',
          data: months.map((m) => m.spendUsd || 0),
          backgroundColor: '#f472b6',
          yAxisID: mkz ? 'yUsd' : 'yKzt',
          spendCur: 'USD'
        })
      }
      if (mrub) {
        monthlyDs.push({
          label: 'Расход (₽)',
          data: months.map((m) => m.spendRub || 0),
          backgroundColor: '#b91c1c',
          yAxisID: mkz || musd ? 'yRub' : 'yKzt',
          spendCur: 'RUB'
        })
      }
      const usesYUsd = monthlyDs.some((ds) => ds.yAxisID === 'yUsd')
      const usesYRub = monthlyDs.some((ds) => ds.yAxisID === 'yRub')
      pushChart(mktSpendCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: months.map((m) => monthLabelRu(m.month)),
          datasets: monthlyDs
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const ds = monthlyDs[ctx.datasetIndex]
                  return `${ds.label}: ${formatMoney(ctx.raw, ds.spendCur || meta.currency)}`
                }
              }
            },
            legend: { display: true }
          },
          scales: {
            yKzt: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              display: mkz || (musd && !mkz) || (mrub && !mkz && !musd),
              title: {
                display: mkz || (musd && !mkz) || (mrub && !mkz && !musd),
                text: mkz ? '₸' : musd && !mkz ? '$' : '₽'
              },
              grid: { drawOnChartArea: true }
            },
            yUsd: {
              type: 'linear',
              position: usdOnRight ? 'right' : 'left',
              beginAtZero: true,
              display: usesYUsd,
              title: { display: usesYUsd, text: '$' },
              grid: { drawOnChartArea: false }
            },
            yRub: {
              type: 'linear',
              position: mkz || musd ? 'right' : 'left',
              offset: usesYRub && (mkz || musd),
              beginAtZero: true,
              display: usesYRub,
              title: { display: usesYRub, text: '₽' },
              grid: { drawOnChartArea: false }
            }
          }
        }
      })
    }

    const mktDailyCtx = document.getElementById('chart-mkt-daily')
    if (mktDailyCtx && result.marketing.daily.length) {
      const d = result.marketing.daily
      const hasGoogleClicks = d.some((x) => (x.clicksGoogle || 0) > 0)
      const has2gisClicks = d.some((x) => (x.clicks2gis || 0) > 0)
      const has2gisBreakdown = TWO_GIS_DAILY_SERIES.some((spec) =>
        d.some((x) => (x[spec.key] || 0) > 0)
      )
      const daily2gis = has2gisBreakdown
        ? TWO_GIS_DAILY_SERIES.filter((spec) => d.some((x) => (x[spec.key] || 0) > 0)).map((spec) => ({
            label: spec.label,
            data: d.map((x) => x[spec.key] || 0),
            borderColor: spec.borderColor,
            borderDash: spec.borderDash,
            tension: 0.15,
            yAxisID: 'y1'
          }))
        : has2gisClicks
          ? [
              {
                label: '2GIS: взаимодействия (сумма кликов)',
                data: d.map((x) => x.clicks2gis || 0),
                borderColor: '#0ea5e9',
                borderDash: [6, 4],
                tension: 0.15,
                yAxisID: 'y1'
              }
            ]
          : []
      const hasYandexVisits = d.some((x) => (x.clicksYandex || 0) > 0)
      const dailyYandex = hasYandexVisits
        ? [
            {
              label: 'Яндекс Метрика: визиты',
              data: d.map((x) => x.clicksYandex || 0),
              borderColor: '#fc0',
              borderDash: [2, 2],
              tension: 0.15,
              yAxisID: 'y1'
            }
          ]
        : []
      const dailyGoogle = hasGoogleClicks
        ? [
            {
              label: 'Google Ads: клики',
              data: d.map((x) => x.clicksGoogle || 0),
              borderColor: '#64748b',
              borderDash: [4, 3],
              tension: 0.15,
              yAxisID: 'y1'
            }
          ]
        : []
      pushChart(mktDailyCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: d.map((x) => x.date),
          datasets: [
            ...dailyGoogle,
            ...daily2gis,
            ...dailyYandex,
            { label: 'Лиды (все каналы)', data: d.map((x) => x.leads), borderColor: '#2563eb', yAxisID: 'y1' },
            {
              label: 'Обращения после продажи',
              data: d.map((x) => x.contactsAfterSale),
              borderColor: '#16a34a',
              yAxisID: 'y1'
            },
            {
              label: 'Заявки на выходе',
              data: d.map((x) => x.applicationsOut),
              borderColor: '#ca8a04',
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y1: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              title: { display: true, text: 'Клики, визиты, взаимодействия' },
              grid: { drawOnChartArea: true }
            }
          }
        }
      })
    }

    const mktFunnelCtx = document.getElementById('chart-mkt-funnel-daily')
    if (mktFunnelCtx && result.marketing.funnelDaily.length) {
      const fd = result.marketing.funnelDaily
      const last = fd.slice(-45)
      pushChart(mktFunnelCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: last.map((x) => x.date),
          datasets: [
            { label: 'Лиды', data: last.map((x) => x.lead), borderColor: '#6366f1' },
            { label: 'Контакты', data: last.map((x) => x.contact), borderColor: '#0ea5e9' },
            { label: 'Диалоги', data: last.map((x) => x.dialog), borderColor: '#22c55e' },
            { label: 'Сделки', data: last.map((x) => x.deal), borderColor: '#eab308' },
            { label: 'Оплаты', data: last.map((x) => x.payment), borderColor: '#dc2626' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } }
        }
      })
    }

    const tbMkt = document.getElementById('tbody-mkt-channels')
    if (tbMkt) {
      tbMkt.innerHTML = ''
      result.marketing.channels.forEach((row) => {
        const tr = document.createElement('tr')
        const cpa = row.leads ? row.spend / row.leads : 0
        const cur = row.spendCurrency || meta.currency
        const cpaText = row.spend > 0 && row.leads ? formatMoney(cpa, cur) : '—'
        ;[
          row.label,
          formatMoney(row.spend, cur),
          String(row.leads),
          String(row.clicks),
          cpaText,
          String(row.contactsAfterSale ?? 0),
          String(row.applicationsOut ?? 0)
        ].forEach((text) => {
          const td = document.createElement('td')
          td.textContent = text
          tr.appendChild(td)
        })
        tbMkt.appendChild(tr)
      })
    }

    const blockDds = document.getElementById('block-dds')
    const ddsHost = document.getElementById('dds-charts-host')
    const stripPay = document.getElementById('payroll-kpi-strip')
    const tbPay = document.getElementById('tbody-finance-payroll')
    if (blockDds) {
      const show = result.financeDds.hasDds || result.financePayroll.hasPayroll
      blockDds.style.display = show ? '' : 'none'
    }
    if (ddsHost) {
      ddsHost.innerHTML = ''
      if (result.financeDds.hasDds) {
        result.financeDds.reports.forEach((rep) => {
          const h = document.createElement('h4')
          h.className = 'chart-section-title'
          h.textContent = `ДДС ${rep.year} (${rep.sheet}) — строки «Итого», ₸`
          ddsHost.appendChild(h)
          const wrap = document.createElement('div')
          wrap.className = 'chart-wrap chart-wrap--tall'
          const cv = document.createElement('canvas')
          cv.setAttribute('role', 'img')
          cv.setAttribute('aria-label', `ДДС ${rep.year}`)
          wrap.appendChild(cv)
          ddsHost.appendChild(wrap)
          pushChart(cv.getContext('2d'), {
            type: 'bar',
            data: {
              labels: rep.monthLabels,
              datasets: [
                { label: 'Доходы (итого)', data: rep.incomeByMonth, backgroundColor: '#22c55e' },
                { label: 'Расходы (итого)', data: rep.expenseByMonth, backgroundColor: '#dc2626' }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'top' } },
              scales: {
                x: { stacked: false },
                y: { beginAtZero: true, title: { display: true, text: '₸' } }
              }
            }
          })
          const tblWrap = document.createElement('div')
          tblWrap.className = 'table-scroll'
          const t = document.createElement('table')
          t.className = 'data-table'
          const thead = document.createElement('thead')
          thead.innerHTML =
            '<tr><th>Статья расхода (топ по итогу в файле)</th><th>Итого, ₸</th></tr>'
          t.appendChild(thead)
          const tb = document.createElement('tbody')
          rep.topExpenseRows.forEach((row) => {
            const tr = document.createElement('tr')
            ;[row.name, formatMoney(row.total || 0, meta.currency)].forEach((text) => {
              const td = document.createElement('td')
              td.textContent = text
              tr.appendChild(td)
            })
            tb.appendChild(tr)
          })
          t.appendChild(tb)
          tblWrap.appendChild(t)
          ddsHost.appendChild(tblWrap)
        })
      }
    }
    if (stripPay) {
      const hp = result.financePayroll.hasPayroll
      stripPay.style.display = hp ? '' : 'none'
      if (hp) {
        setText('payroll-rows-count', String(result.financePayroll.count))
        setText('payroll-rows-sum', formatMoney(result.financePayroll.total, meta.currency))
      }
    }
    if (tbPay) {
      tbPay.innerHTML = ''
      if (result.financePayroll.hasPayroll) {
        result.financePayroll.rows.forEach((row) => {
          const tr = document.createElement('tr')
          ;[
            row.date,
            row.role || '—',
            row.employeeName || '—',
            formatMoney(row.amount || 0, meta.currency)
          ].forEach((text) => {
            const td = document.createElement('td')
            td.textContent = text
            tr.appendChild(td)
          })
          tbPay.appendChild(tr)
        })
      }
    }
  }

  // ─── COST MODEL RENDER ─────────────────────────────────────────────────────

  /** Отдельный реестр графиков cost-model, не затрагивается destroyCharts() */
  const costChartRegistry = []
  const pushCostChart = (ctx, config) => {
    const chart = new Chart(ctx, config)
    costChartRegistry.push(chart)
    return chart
  }
  const destroyCostCharts = () => {
    while (costChartRegistry.length) {
      try { costChartRegistry.pop().destroy() } catch (e) { /* ignore */ }
    }
  }

  const formatCompact = (n) => {
    const abs = Math.abs(n || 0)
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (abs >= 1e3) return (n / 1e3).toFixed(0) + 'K'
    return String(Math.round(n || 0))
  }

  const badgeClass = (pct) => {
    const a = Math.abs(pct)
    if (a <= 5)  return 'badge--green'
    if (a <= 15) return 'badge--yellow'
    return 'badge--red'
  }

  const makeBadge = (pct) => {
    if (pct == null || !isFinite(pct)) return ''
    const cls = badgeClass(pct)
    const sign = pct >= 0 ? '+' : ''
    return `<span class="cost-badge ${cls}">${sign}${pct.toFixed(1)}%</span>`
  }

  const setTileState = (tileId, state) => {
    const el = document.getElementById(tileId)
    if (!el) return
    el.classList.remove('tile--good', 'tile--warn', 'tile--bad', 'tile--green', 'tile--orange', 'tile--red', 'tile--blue', 'tile--purple')
    if (state) el.classList.add(`tile--${state}`)
  }

  const renderCostKPIs = (cost) => {
    setText('cost-kpi-sqm',    formatMoney(cost.planCostPerSqm,    'KZT'))
    setText('cost-kpi-order',  formatMoney(cost.planCostPerOrder,  'KZT'))
    setText('cost-kpi-check',  formatMoney(cost.planPrice,          'KZT'))
    setText('cost-kpi-profit', formatMoney(cost.planProfitPerOrder, 'KZT'))
    setText('cost-kpi-margin', formatPct(cost.planMargin * 100))
    setTileState('cost-kpi-margin-tile', cost.marginColor)
  }

  const renderCostBreakdownChart = (cost) => {
    const ctx = document.getElementById('chart-cost-breakdown')
    if (!ctx) return
    const CM = global.DaraCostModel
    // Stacked bar — одна горизонтальная полоса, каждый блок — датасет
    const datasets = CM.BLOCK_KEYS.map((k) => {
      const row = cost.blockRows.find(r => r.key === k)
      return {
        label: row.label,
        data: [row.planAmt],
        backgroundColor: row.color,
        borderWidth: 0
      }
    })
    pushCostChart(ctx.getContext('2d'), {
      type: 'bar',
      data: { labels: ['Себестоимость'], datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, color: '#94a3b8' } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const row = cost.blockRows[ctx.datasetIndex]
                const pct = (row.planAmt / cost.planTotalCogs * 100).toFixed(1)
                return ` ${ctx.dataset.label}: ${formatMoney(ctx.raw, 'KZT')} (${pct}%)`
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            ticks: { display: false },
            grid: { display: false },
            border: { display: false }
          },
          y: {
            stacked: true,
            ticks: { display: false },
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    })
  }

  const renderCostTable = (cost, plan, onPlanChange) => {
    const tbody = document.getElementById('tbody-cost-model')
    if (!tbody) return

    // Запоминаем активный input чтобы восстановить фокус
    const activeEl = document.activeElement
    const activeBlockId = activeEl && activeEl.dataset && activeEl.dataset.blockId
    const activeCursorPos = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null

    tbody.innerHTML = ''

    const addRow = (cells, cls) => {
      const tr = document.createElement('tr')
      if (cls) tr.className = cls
      cells.forEach(cell => {
        const td = document.createElement('td')
        if (cell && typeof cell === 'object' && cell.node) {
          td.appendChild(cell.node)
          if (cell.cls) td.className = cell.cls
        } else {
          if (typeof cell === 'string' && cell.includes('<')) {
            td.innerHTML = cell
          } else {
            td.textContent = cell != null ? String(cell) : ''
          }
          td.className = 'num'
        }
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }

    const makeInput = (key, value) => {
      const inp = document.createElement('input')
      inp.type = 'number'
      inp.className = 'cost-input'
      inp.value = Math.round(value)
      inp.min = '0'
      inp.dataset.blockId = key
      const debounced = global.DaraCostModel.debounce((val) => {
        onPlanChange(key, Math.max(0, parseFloat(val) || 0))
      }, 300)
      inp.addEventListener('input', (e) => debounced(e.target.value))
      return inp
    }

    // Блоки себестоимости
    cost.blockRows.forEach(row => {
      const dot = `<span class="block-dot" style="background:${row.color}"></span>`
      const labelCell = `${dot}${row.label}<span class="cost-note">${row.note}</span>`
      const inp = makeInput(row.key, row.planAmt)
      addRow([
        { node: (() => { const td = document.createElement('span'); td.innerHTML = labelCell; return td })(), cls: '' },
        formatCompact(row.factAmt) + ' ₸',
        formatPct(row.factPct * 100),
        Math.round(row.factPerSqm) + ' ₸',
        Math.round(row.factPerOrder) + ' ₸',
        { node: inp, cls: 'num' },
        makeBadge(row.delta)
      ])
    })

    // Итого
    addRow([
      'ИТОГО себестоимость',
      formatCompact(cost.factTotalCogs) + ' ₸',
      '100%',
      Math.round(cost.factCostPerSqm) + ' ₸',
      Math.round(cost.factCostPerOrder) + ' ₸',
      formatCompact(cost.planTotalCogs) + ' ₸',
      makeBadge(cost.totalCogsDelta)
    ], 'row-total')

    // Цена продажи (editable)
    const priceInp = makeInput('__price__', plan.planPrice)
    addRow([
      'Цена продажи (ср.чек)',
      Math.round(cost.factPrice) + ' ₸',
      '—',
      Math.round(cost.factPrice / (FACTS_SQM_PER_ORDER(cost))) + ' ₸',
      Math.round(cost.factPrice) + ' ₸',
      { node: priceInp, cls: 'num' },
      makeBadge(cost.priceDelta)
    ], 'row-derived')

    // Прибыль
    addRow([
      'Прибыль на заказ',
      Math.round(cost.factProfitPerOrder) + ' ₸',
      formatPct(cost.factMargin * 100),
      '—',
      '—',
      Math.round(cost.planProfitPerOrder) + ' ₸',
      makeBadge(cost.planProfitPerOrder > 0 ? null : -100)
    ], cost.planProfitPerOrder < 0 ? 'row-highlight' : 'row-derived')

    // Маржа
    const mClass = cost.planMargin >= 0.20 ? 'badge--green' : cost.planMargin >= 0.10 ? 'badge--yellow' : 'badge--red'
    const fClass  = cost.factMargin  >= 0.20 ? 'badge--green' : cost.factMargin  >= 0.10 ? 'badge--yellow' : 'badge--red'
    addRow([
      'Валовая маржа',
      `<span class="cost-badge ${fClass}">${formatPct(cost.factMargin * 100)}</span>`,
      '—', '—', '—',
      `<span class="cost-badge ${mClass}">${formatPct(cost.planMargin * 100)}</span>`,
      ''
    ], 'row-derived')

    // Восстанавливаем фокус
    if (activeBlockId) {
      const restored = tbody.querySelector(`input[data-block-id="${activeBlockId}"]`)
      if (restored) {
        restored.focus()
        if (activeCursorPos != null) {
          try { restored.setSelectionRange(activeCursorPos, activeCursorPos) } catch (e) { /* ignore */ }
        }
      }
    }
  }

  // Хелпер: средняя площадь заказа
  const FACTS_SQM_PER_ORDER = (cost) => {
    if (!global.DaraCostModel) return 24.6
    const F = global.DaraCostModel.FACTS
    return F.totalSqm / F.totalOrders
  }

  const renderCACTable = (cac, plan, onBudgetChange) => {
    const tbody = document.getElementById('tbody-cac-ltv')
    if (!tbody) return

    const activeEl = document.activeElement
    const activeId = activeEl && activeEl.dataset && activeEl.dataset.blockId
    const activeCur = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null

    tbody.innerHTML = ''

    // Итоговые KPI
    setText('cac-ltv-value',  formatMoney(cac.ltv, 'KZT'))
    setText('cac-blended',    cac.blendedFactCAC > 0 ? formatMoney(cac.blendedFactCAC, 'KZT') : '—')
    const ratio = cac.blendedFactCAC > 0 ? (cac.ltv / cac.blendedFactCAC).toFixed(1) + 'x' : '—'
    setText('cac-ltv-ratio', ratio)

    cac.rows.forEach(row => {
      const tr = document.createElement('tr')

      const cells = [row.label]

      // Факт бюджет
      const tdFact = document.createElement('td')
      tdFact.className = 'num'
      tdFact.textContent = row.factBudget > 0 ? formatMoney(row.factBudget, 'KZT') : '—'
      tr.appendChild(document.createElement('td')).textContent = row.label
      tr.removeChild(tr.lastChild)

      const addTd = (text, cls) => {
        const td = document.createElement('td')
        td.className = cls || 'num'
        if (typeof text === 'string' && text.includes('<')) td.innerHTML = text
        else td.textContent = text != null ? String(text) : '—'
        tr.appendChild(td)
        return td
      }

      addTd(row.label, '')
      addTd(row.factBudget > 0 ? formatMoney(row.factBudget, 'KZT') : '—')
      addTd(String(row.inquiries))
      addTd(String(row.orders))
      addTd(String(row.newOrders))
      addTd(row.factCAC > 0 ? formatMoney(row.factCAC, 'KZT') : '—')

      // Editable plan budget
      if (row.isPaid) {
        const inp = document.createElement('input')
        inp.type = 'number'
        inp.className = 'cost-input'
        inp.value = Math.round(row.planBudget)
        inp.min = '0'
        inp.dataset.blockId = 'cac_' + row.id
        const debounced = global.DaraCostModel.debounce((val) => {
          onBudgetChange(row.id, Math.max(0, parseFloat(val) || 0))
        }, 300)
        inp.addEventListener('input', (e) => debounced(e.target.value))
        const tdInp = document.createElement('td')
        tdInp.className = 'num'
        tdInp.appendChild(inp)
        tr.appendChild(tdInp)
      } else {
        addTd('—')
      }

      addTd(row.planCAC > 0 ? formatMoney(row.planCAC, 'KZT') : '—')

      const ltvRatioVal = row.planCAC > 0 ? (cac.ltv / row.planCAC) : (row.factCAC > 0 ? cac.ltv / row.factCAC : null)
      if (ltvRatioVal !== null) {
        const ltvBadgeCls = ltvRatioVal >= 10 ? 'badge--green' : ltvRatioVal >= 3 ? 'badge--yellow' : 'badge--red'
        addTd(`<span class="cost-badge ${ltvBadgeCls}">${ltvRatioVal.toFixed(1)}x</span>`)
      } else {
        addTd('∞')
      }

      addTd(row.isPaid ? String(row.forecastOrders) : '—')

      tbody.appendChild(tr)
    })

    // Восстанавливаем фокус
    if (activeId) {
      const restored = tbody.querySelector(`input[data-block-id="${activeId}"]`)
      if (restored) {
        restored.focus()
        if (activeCur != null) {
          try { restored.setSelectionRange(activeCur, activeCur) } catch (e) { /* ignore */ }
        }
      }
    }
  }

  const renderBreakevenKPIs = (be) => {
    setText('be-fixed',        formatMoney(be.fixedCostsYear, 'KZT'))
    setText('be-variable',     formatMoney(be.variablePerOrder, 'KZT'))
    setText('be-contribution', formatMoney(be.contributionMarginFact, 'KZT'))
    setText('be-orders-month', be.beOrdersMonthFact ? Math.round(be.beOrdersMonthFact) + ' зак/мес' : '—')
    setText('be-safety', be.safetyPct != null ? formatPct(be.safetyPct) : '—')
    setTileState('be-safety-tile', be.safetyColor)
  }

  const renderBreakevenChart = (be) => {
    const ctx = document.getElementById('chart-breakeven')
    if (!ctx) return
    const bePoint = be.beOrdersMonthFact ? Math.round(be.beOrdersMonthFact) : 313
    const fact = be.factOrdersMonth

    pushCostChart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Факт (заказов/мес)', 'Break-even (заказов/мес)'],
        datasets: [{
          data: [fact, bePoint],
          backgroundColor: [
            fact > bePoint ? '#22c55e' : '#ef4444',
            '#6b7280'
          ],
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.raw} заказов/мес`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(148,163,184,0.1)' }
          },
          y: { ticks: { color: '#94a3b8' } }
        }
      },
      plugins: [{
        id: 'beLinePlugin',
        afterDraw (chart) {
          const xScale = chart.scales.x
          if (!xScale) return
          const xPx = xScale.getPixelForValue(bePoint)
          const { top, bottom } = chart.chartArea
          const c = chart.ctx
          c.save()
          c.strokeStyle = '#ef4444'
          c.lineWidth = 2
          c.setLineDash([6, 4])
          c.beginPath()
          c.moveTo(xPx, top)
          c.lineTo(xPx, bottom)
          c.stroke()
          c.fillStyle = '#ef4444'
          c.font = '11px Segoe UI, system-ui'
          c.fillText(`break-even: ${bePoint}`, xPx + 4, top + 14)
          c.restore()
        }
      }]
    })
  }

  /**
   * Главный оркестратор рендера модуля себестоимости.
   * Вызывается один раз при init, затем автоматически при каждом изменении плана.
   */
  const renderCostModel = (result) => {
    const { cost, cac, breakeven, plan } = result

    destroyCostCharts()

    renderCostKPIs(cost)
    renderCostBreakdownChart(cost)

    const onPlanChange = (key, value) => {
      if (key === '__price__') {
        plan.planPrice = value > 0 ? value : 1
      } else {
        plan.planBlocks[key] = value
      }
      global.DaraCostModel.savePlan(plan)
      const fresh = global.DaraCostModel.computeAll()
      renderCostModel(fresh)
    }

    renderCostTable(cost, plan, onPlanChange)

    const onBudgetChange = (channelId, value) => {
      plan.channelBudgets[channelId] = value
      global.DaraCostModel.savePlan(plan)
      const fresh = global.DaraCostModel.computeAll()
      renderCostModel(fresh)
    }

    renderCACTable(cac, plan, onBudgetChange)
    renderBreakevenKPIs(breakeven)
    renderBreakevenChart(breakeven)
  }

  global.DashboardUI = {
    renderAll,
    renderCostModel,
    destroyCharts,
    formatMoney,
    formatPct
  }
})(typeof window !== 'undefined' ? window : globalThis)
