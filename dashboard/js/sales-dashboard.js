;(function (global) {
  'use strict'

  const qs = (id) => document.getElementById(id)
  const DC = () => global.DC || {}
  const fmt = {
    money: (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' ₸',
    num:   (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0),
    pct:   (n, d) => (n || 0).toFixed(d != null ? d : 1) + '%'
  }

  const charts = {}
  function destroyChart(key) {
    if (charts[key]) { try { charts[key].destroy() } catch(_) {} delete charts[key] }
  }

  function getData() {
    return global.DashboardData || (global.DashboardDemo ? global.DashboardDemo.generateDemoData() : null)
  }

  function getFilters() {
    const periodEl = document.getElementById('sel-period')
    const period = periodEl ? periodEl.value : 'year'
    const today = new Date()
    const toISO = today.toISOString().slice(0, 10)
    let fromISO
    if (period === 'month') {
      fromISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    } else if (period === 'quarter') {
      const qStart = Math.floor(today.getMonth() / 3) * 3
      fromISO = `${today.getFullYear()}-${String(qStart + 1).padStart(2, '0')}-01`
    } else {
      fromISO = `${today.getFullYear()}-01-01`
    }
    return { dateFrom: fromISO, dateTo: toISO }
  }

  function showPage(contentId, loadingId) {
    const l = qs(loadingId), c = qs(contentId)
    if (l) l.style.display = 'none'
    if (c) c.style.display = 'block'
  }

  // ─── ВОРОНКА ──────────────────────────────────────────────────────────────
  function renderFunnel() {
    const rawData = getData()
    if (!rawData || !global.SalesFunnel) { showPage('funnel-content', 'funnel-loading'); return }
    const filters = getFilters()
    const result = global.SalesFunnel.compute(rawData, filters)

    // KPI
    const kpiEl = qs('funnel-kpis')
    if (kpiEl) {
      const k = result.kpiCards
      const cards = [
        { label: 'Заказов (месяц)', value: fmt.num(k.ordersMonth.fact), sub: `план: ${fmt.num(k.ordersMonth.plan)}`, pct: k.ordersMonth.pct, color: 'purple' },
        { label: 'Выручка (месяц)', value: fmt.money(k.revenueMonth.fact), sub: `план: ${fmt.money(k.revenueMonth.plan)}`, pct: k.revenueMonth.pct, color: 'blue' },
        { label: 'Средний чек', value: fmt.money(k.avgCheck.fact), sub: `план: ${fmt.money(k.avgCheck.plan)}`, pct: k.avgCheck.plan > 0 ? Math.round(k.avgCheck.fact / k.avgCheck.plan * 100) : 0, color: 'orange' },
        { label: 'Конверсия', value: fmt.pct(k.conversionRate.value), sub: `план: ${fmt.pct(k.conversionRate.plan)}`, pct: k.conversionRate.plan > 0 ? Math.round(k.conversionRate.value / k.conversionRate.plan * 100) : 0, color: 'green' },
        { label: 'Новых клиентов', value: fmt.num(k.newClients.count), sub: `план: ~${fmt.num(k.newClients.plan)}`, pct: k.newClients.plan > 0 ? Math.round(k.newClients.count / k.newClients.plan * 100) : 0, color: 'red' }
      ]
      kpiEl.innerHTML = cards.map((c) => {
        const barPct = Math.min(100, c.pct || 0)
        const cls = c.pct >= 90 ? 'good' : c.pct >= 60 ? '' : 'bad'
        return `<div class="kpi-card kpi-card--${c.color}">
  <div class="kpi-card__label">${c.label}</div>
  <div class="kpi-card__value">${c.value}</div>
  <div class="kpi-card__delta" style="color:var(--text-secondary)">${c.sub}</div>
  <div class="kpi-card__progress">
    <div class="kpi-card__progress-fill${cls ? ' kpi-card__progress-fill--' + cls : ''}" style="width:${barPct.toFixed(1)}%"></div>
  </div>
</div>`
      }).join('')
    }

    // SVG воронка
    const svgHost = qs('funnel-svg')
    if (svgHost) renderFunnelSVG(svgHost, result.funnel6, (stage) => renderFunnelDetail(stage, result))

    showPage('funnel-content', 'funnel-loading')
  }

  function renderFunnelDetail(stage, result) {
    const detail = qs('funnel-detail')
    if (!detail) return
    const level = result.funnel6.find((f) => f.stage === stage)
    if (!level) return
    detail.innerHTML = `<div class="card">
  <div class="card__title">${level.label}</div>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0">
    <div class="kpi-card kpi-card--blue"><div class="kpi-card__label">Кол-во</div><div class="kpi-card__value">${level.count != null ? fmt.num(level.count) : '—'}</div></div>
    <div class="kpi-card kpi-card--green"><div class="kpi-card__label">Сумма</div><div class="kpi-card__value">${level.amount > 0 ? fmt.money(level.amount) : '—'}</div></div>
    <div class="kpi-card kpi-card--orange"><div class="kpi-card__label">Конверсия</div><div class="kpi-card__value">${level.convFrom != null ? fmt.pct(level.convFrom) : '—'}</div></div>
  </div>
</div>`
  }

  function renderFunnelSVG(host, funnel6, onClickStage) {
    host.innerHTML = ''
    const W = Math.max(host.clientWidth || 500, 300)
    const LAYER_H = 76, GAP = 4
    const totalH = funnel6.length * (LAYER_H + GAP)
    const COLORS = ['#8280FF', '#4880FF', '#4AD991', '#FF9872', '#F87171', '#06b6d4']
    const maxCount = Math.max(...funnel6.map((f) => f.count || 1), 1)
    const NS = 'http://www.w3.org/2000/svg'

    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${totalH}`)
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', totalH)
    svg.style.display = 'block'

    funnel6.forEach((level, i) => {
      const ratio = Math.max(0.3, Math.min(0.96, ((level.count || 1) / maxCount) * 0.96))
      const w = W * ratio, x = (W - w) / 2, y = i * (LAYER_H + GAP)
      const next = funnel6[i + 1]
      const nRatio = next ? Math.max(0.3, Math.min(0.96, ((next.count || 1) / maxCount) * 0.96)) : 0.3
      const nw = W * nRatio, nx = (W - nw) / 2

      const g = document.createElementNS(NS, 'g')
      g.style.cursor = onClickStage ? 'pointer' : 'default'

      const poly = document.createElementNS(NS, 'polygon')
      poly.setAttribute('points', `${x},${y} ${x+w},${y} ${nx+nw},${y+LAYER_H} ${nx},${y+LAYER_H}`)
      poly.setAttribute('fill', COLORS[i % COLORS.length])
      poly.setAttribute('opacity', '0.88')
      poly.addEventListener('mouseenter', () => { poly.setAttribute('opacity', '1') })
      poly.addEventListener('mouseleave', () => { poly.setAttribute('opacity', '0.88') })

      const cy = y + LAYER_H / 2
      const mk = (tag, attrs, txt) => {
        const el = document.createElementNS(NS, tag)
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
        if (txt != null) el.textContent = txt
        return el
      }

      g.appendChild(poly)
      g.appendChild(mk('text', { x: W/2, y: cy - 7, 'text-anchor': 'middle', fill: '#fff', 'font-size': '13', 'font-weight': '600', 'font-family': 'Inter,system-ui,sans-serif' }, level.label))
      g.appendChild(mk('text', { x: W/2, y: cy + 11, 'text-anchor': 'middle', fill: 'rgba(255,255,255,0.88)', 'font-size': '11', 'font-family': 'Inter,system-ui,sans-serif' },
        level.count != null
          ? fmt.num(level.count) + (level.amount > 0 ? ' · ' + fmt.money(level.amount) : '')
          : fmt.money(level.amount)
      ))

      if (level.convFrom != null) {
        svg.appendChild(mk('text', { x: W/2, y: y - 3, 'text-anchor': 'middle', fill: '#4880FF', 'font-size': '10', 'font-family': 'Inter,system-ui,sans-serif' }, `↓ ${fmt.pct(level.convFrom)}`))
      }

      if (onClickStage) g.addEventListener('click', () => onClickStage(level.stage))
      svg.appendChild(g)
    })

    host.appendChild(svg)
  }

  // ─── МЕНЕДЖЕРЫ ────────────────────────────────────────────────────────────
  function renderManagers() {
    const rawData = getData()
    if (!rawData || !global.SalesFunnel) { showPage('smgr-content', 'smgr-loading'); return }
    const filters = getFilters()
    const result = global.SalesFunnel.compute(rawData, filters)

    const kpiEl = qs('smgr-kpis')
    if (kpiEl) {
      const tot = result.managerExtended.reduce((s, m) => ({ leads: s.leads + m.leads, orders: s.orders + m.orders, revenue: s.revenue + m.revenue }), { leads: 0, orders: 0, revenue: 0 })
      const avgConv = tot.leads > 0 ? tot.orders / tot.leads * 100 : 0
      kpiEl.innerHTML = [
        { label: 'Обращений', value: fmt.num(tot.leads), color: 'purple' },
        { label: 'Заказов', value: fmt.num(tot.orders), color: 'blue' },
        { label: 'Выручка', value: fmt.money(tot.revenue), color: 'green' },
        { label: 'Ср. конверсия', value: fmt.pct(avgConv), color: 'orange' }
      ].map((c) => `<div class="kpi-card kpi-card--${c.color}"><div class="kpi-card__label">${c.label}</div><div class="kpi-card__value">${c.value}</div></div>`).join('')
    }

    destroyChart('smgr-bar')
    const canvas = qs('chart-smgr-bar')
    if (canvas && result.managerExtended.length) {
      charts['smgr-bar'] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: result.managerExtended.map((m) => m.name),
          datasets: [
            { label: 'Заказов', data: result.managerExtended.map((m) => m.orders), backgroundColor: '#4880FF', borderRadius: 4 },
            { label: 'Конверсия %', data: result.managerExtended.map((m) => m.conversion), backgroundColor: '#4AD991', borderRadius: 4, yAxisID: 'y2' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { font: { size: 11 } } } },
          scales: {
            x: { ticks: { font: { size: 11 } } },
            y: { title: { display: true, text: 'Заказов' }, ticks: { font: { size: 11 } } },
            y2: { position: 'right', title: { display: true, text: 'Конв %' }, grid: { drawOnChartArea: false }, ticks: { font: { size: 11 } } }
          }
        }
      })
    }

    const tableEl = qs('smgr-table')
    if (tableEl) {
      tableEl.innerHTML = `<table class="data-table">
<thead><tr>
  <th>Менеджер</th><th class="num">Обращений</th><th class="num">Заказов</th>
  <th class="num">Конверсия</th><th class="num">Выручка</th><th class="num">Ср. чек</th>
  <th class="num">Недозвоны</th><th class="num">Отказы</th><th class="num">Перезвоны</th>
</tr></thead>
<tbody>${result.managerExtended.map((m) => {
  const cls = m.conversion >= 50 ? 'good' : m.conversion >= 35 ? 'warn' : 'bad'
  return `<tr>
    <td><strong>${m.name}</strong></td>
    <td class="num">${fmt.num(m.leads)}</td>
    <td class="num">${fmt.num(m.orders)}</td>
    <td class="num"><span class="badge badge--${cls}">${fmt.pct(m.conversion)}</span></td>
    <td class="num">${fmt.money(m.revenue)}</td>
    <td class="num">${fmt.money(m.avgCheck)}</td>
    <td class="num">${fmt.num(m.missedCalls)}</td>
    <td class="num">${fmt.num(m.rejections)}</td>
    <td class="num">${fmt.num(m.callbacks)} <small style="color:var(--text-muted)">(${fmt.pct(m.callbackPct)})</small></td>
  </tr>`
}).join('')}</tbody></table>`
    }

    showPage('smgr-content', 'smgr-loading')
  }

  // ─── КАНАЛЫ ───────────────────────────────────────────────────────────────
  function renderChannels() {
    const rawData = getData()
    if (!rawData || !global.SalesFunnel) { showPage('sch-content', 'sch-loading'); return }
    const filters = getFilters()
    const result = global.SalesFunnel.compute(rawData, filters)
    const nv = result.newVsRepeat

    destroyChart('sch-donut')
    const donutCanvas = qs('chart-sch-donut')
    if (donutCanvas) {
      const total = nv.new.count + nv.repeat.count
      if (total > 0) {
        charts['sch-donut'] = new Chart(donutCanvas, {
          type: 'doughnut',
          data: {
            labels: [`Новые (${(nv.new.count/total*100).toFixed(0)}%)`, `Повторные (${(nv.repeat.count/total*100).toFixed(0)}%)`],
            datasets: [{ data: [nv.new.count, nv.repeat.count], backgroundColor: ['#4880FF', '#8280FF'], borderWidth: 2, borderColor: '#fff' }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '60%',
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 11 } } },
              tooltip: { callbacks: { label: (ctx) => {
                const d = ctx.dataIndex === 0 ? nv.new : nv.repeat
                return [`${ctx.label}`, `Заказов: ${fmt.num(d.count)}`, `Выручка: ${fmt.money(d.revenue)}`, `Ср. чек: ${fmt.money(d.avgCheck)}`]
              }}}
            }
          }
        })
      }
    }

    destroyChart('sch-rej')
    const rejCanvas = qs('chart-sch-rejections')
    if (rejCanvas && result.rejectionReasons.length) {
      const top = result.rejectionReasons.slice(0, 6)
      charts['sch-rej'] = new Chart(rejCanvas, {
        type: 'bar',
        data: {
          labels: top.map((r) => r.reason),
          datasets: [{ label: 'Отказов', data: top.map((r) => r.count), backgroundColor: ['#ef4444','#f97316','#eab308','#84cc16','#06b6d4','#8280FF'], borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.formattedValue} (${fmt.pct(top[ctx.dataIndex].pctOfRejections)} от отказов)` } } },
          scales: { x: { ticks: { font: { size: 11 } } }, y: { ticks: { font: { size: 11 } } } }
        }
      })
    }

    const tableEl = qs('sch-table')
    if (tableEl) {
      tableEl.innerHTML = `<table class="data-table">
<thead><tr>
  <th>Источник</th><th class="num">Обращений</th><th class="num">Заказов</th>
  <th class="num">Конверсия</th><th class="num">Сумма</th><th class="num">Ср. чек</th><th class="num">CAC</th><th class="num">ROAS</th>
</tr></thead>
<tbody>${result.channelTable.map((c) => {
  const cls = c.conversion >= 50 ? 'good' : c.conversion >= 30 ? 'warn' : 'bad'
  const roas = c.cac != null && c.cac > 0 && c.amount > 0
    ? (c.amount / (c.cac * c.orders)).toFixed(1) + 'x'
    : c.cac === 0 || c.cac == null ? '∞' : '—'
  const roasCls = roas === '∞' ? 'good' : parseFloat(roas) >= 5 ? 'good' : parseFloat(roas) >= 2 ? 'warn' : 'bad'
  return `<tr>
    <td><strong>${c.label}</strong></td>
    <td class="num">${fmt.num(c.leads)}</td><td class="num">${fmt.num(c.orders)}</td>
    <td class="num"><span class="badge badge--${cls}">${fmt.pct(c.conversion)}</span></td>
    <td class="num">${fmt.money(c.amount)}</td><td class="num">${fmt.money(c.avgCheck)}</td>
    <td class="num">${c.cac != null ? fmt.money(c.cac) : '—'}</td>
    <td class="num"><span class="badge badge--${roasCls}">${roas}</span></td>
  </tr>`
}).join('')}</tbody></table>`
    }

    showPage('sch-content', 'sch-loading')
  }

  // ─── КЛИЕНТЫ ──────────────────────────────────────────────────────────────
  function renderClients() {
    const rawData = getData()
    if (!rawData || !global.SalesFunnel) { showPage('scl-content', 'scl-loading'); return }
    const filters = getFilters()
    const result = global.SalesFunnel.compute(rawData, filters)
    const nv = result.newVsRepeat

    destroyChart('scl-donut')
    const donutCanvas = qs('chart-scl-donut')
    if (donutCanvas) {
      const total = nv.new.count + nv.repeat.count
      if (total > 0) {
        charts['scl-donut'] = new Chart(donutCanvas, {
          type: 'doughnut',
          data: {
            labels: ['Новые клиенты', 'Повторные клиенты'],
            datasets: [{ data: [nv.new.count, nv.repeat.count], backgroundColor: ['#4880FF', '#4AD991'], borderWidth: 2, borderColor: '#fff' }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
        })
      }
    }

    const statsEl = qs('scl-stats')
    if (statsEl) {
      statsEl.innerHTML = `<div class="card__title">Статистика клиентов</div>
<div class="kpi-grid" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
  <div class="kpi-card kpi-card--blue">
    <div class="kpi-card__label">Новые</div>
    <div class="kpi-card__value">${fmt.num(nv.new.count)}</div>
    <div class="kpi-card__delta" style="color:var(--text-secondary)">Выручка: ${fmt.money(nv.new.revenue)}</div>
    <div class="kpi-card__delta" style="color:var(--text-secondary)">Ср.чек: ${fmt.money(nv.new.avgCheck)}</div>
  </div>
  <div class="kpi-card kpi-card--green">
    <div class="kpi-card__label">Повторные</div>
    <div class="kpi-card__value">${fmt.num(nv.repeat.count)}</div>
    <div class="kpi-card__delta" style="color:var(--text-secondary)">Выручка: ${fmt.money(nv.repeat.revenue)}</div>
    <div class="kpi-card__delta" style="color:var(--text-secondary)">Ср.чек: ${fmt.money(nv.repeat.avgCheck)}</div>
  </div>
</div>
<div style="padding:12px;background:#F0F5FF;border-radius:8px;font-size:13px;color:var(--text-primary)">
  <strong>CAC blended:</strong> ${fmt.money(nv.blendedCAC)}
  ${nv.repeat.count > 0 && nv.new.count > 0 && nv.repeat.avgCheck > nv.new.avgCheck
    ? `<br><span style="color:var(--color-income)">Повторные дают на ${fmt.pct((nv.repeat.avgCheck/nv.new.avgCheck - 1) * 100, 0)} выше средний чек</span>`
    : ''}
</div>`
    }

    showPage('scl-content', 'scl-loading')
  }

  // ─── ПЛАН ─────────────────────────────────────────────────────────────────
  const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  function renderPlan() {
    let rawData = getData()
    if (!global.SalesFunnel) { showPage('splan-content', 'splan-loading'); return }
    // Если нет реальных данных — используем пустую заглушку для работы плана
    if (!rawData) {
      rawData = { transactions: [], managers: [], products: [], clients: [], plans: {}, marketingDaily: [], funnelSnapshots: [], cashLedger: [], dds: [] }
    }
    const filters = getFilters()
    const result = global.SalesFunnel.compute(rawData, filters)

    // Трекер прогресса
    const trackerEl = qs('splan-tracker')
    if (trackerEl) renderTrackerInto(trackerEl, result.progressTracker)

    // Декомпозиция + редактор
    const decompEl = qs('splan-decomp')
    if (decompEl) {
      const monthly = result.decomp.monthly
      decompEl.innerHTML = `<table class="data-table">
<thead><tr>
  <th>Месяц</th><th class="num">Заказов</th><th class="num">Выручка</th><th class="num">Лидов нужно</th>
</tr></thead>
<tbody>${monthly.map((m) => `<tr>
  <td>${m.label}</td>
  <td class="num">${fmt.num(m.ordersTarget)}</td>
  <td class="num">${fmt.money(m.revenueTarget)}</td>
  <td class="num">${fmt.num(m.leadsTarget)}</td>
</tr>`).join('')}</tbody>
<tfoot><tr style="font-weight:700;border-top:2px solid rgba(0,0,0,0.1)">
  <td>Год</td>
  <td class="num">${fmt.num(monthly.reduce((s, m) => s + m.ordersTarget, 0))}</td>
  <td class="num">${fmt.money(monthly.reduce((s, m) => s + m.revenueTarget, 0))}</td>
  <td class="num">${fmt.num(monthly.reduce((s, m) => s + m.leadsTarget, 0))}</td>
</tr></tfoot>
</table>
${renderPlanEditorHTML(result.planParams)}`

      setTimeout(() => attachPlanEditorListeners(rawData, filters), 50)
    }

    showPage('splan-content', 'splan-loading')
  }

  function renderTrackerInto(el, tracker) {
    el.innerHTML = tracker.map((row) => {
      const oPct = Math.min(100, row.orderPct || 0)
      const cls = row.orderPct >= 90 ? 'good' : row.orderPct >= 60 ? '' : 'bad'
      return `<div style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.05)">
  <div style="display:flex;justify-content:space-between;margin-bottom:6px">
    <span style="font:600 13px/1 var(--font);color:var(--text-primary)">${row.label}</span>
    <span class="badge badge--${cls || 'warn'}">${fmt.pct(row.orderPct)}</span>
  </div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
    <span style="font:400 12px/1 var(--font);color:var(--text-secondary);min-width:180px">Заказы: ${fmt.num(row.orders)} / ${fmt.num(row.ordersTarget)}</span>
    <div class="progress-bar" style="flex:1"><div class="progress-bar__fill progress-bar__fill--${cls || 'warn'}" style="width:${oPct.toFixed(1)}%"></div></div>
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <span style="font:400 12px/1 var(--font);color:var(--text-secondary);min-width:180px">Выручка: ${fmt.money(row.revenue)} / ${fmt.money(row.revenueTarget)}</span>
    <div class="progress-bar" style="flex:1"><div class="progress-bar__fill progress-bar__fill--${Math.min(100, row.revenuePct) >= 90 ? 'good' : Math.min(100, row.revenuePct) >= 60 ? '' : 'bad'}" style="width:${Math.min(100, row.revenuePct || 0).toFixed(1)}%"></div></div>
  </div>
</div>`
    }).join('')
  }

  function renderPlanEditorHTML(p) {
    const fields = [
      { id: 'pe-yearRevenue', label: 'Годовая выручка (₸)', val: p.yearRevenue, step: 1000000 },
      { id: 'pe-yearOrders', label: 'Годовые заказы', val: p.yearOrders, step: 100 },
      { id: 'pe-targetAvgCheck', label: 'Целевой ср. чек (₸)', val: p.targetAvgCheck, step: 1000 },
      { id: 'pe-targetConversion', label: 'Целевая конверсия (%)', val: Math.round(p.targetConversion * 100), step: 1 },
      { id: 'pe-withdrawalCap', label: 'Лимит вывода/мес (₸)', val: p.withdrawalCap, step: 50000 },
      { id: 'pe-growthPct', label: 'Рост %', val: p.growthPct, step: 5 }
    ]
    return `<div class="section-title" style="margin-top:20px">Параметры плана (редактируемые)</div>
<div id="plan-editor-wrap" style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:var(--border-radius);padding:16px">
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px 14px;margin-bottom:14px">
    ${fields.map((f) => `<label style="display:flex;flex-direction:column;gap:4px">
      <span style="font:500 11px/1 var(--font);text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">${f.label}</span>
      <input type="number" id="${f.id}" value="${f.val}" step="${f.step}" style="padding:6px 10px;border:1px solid #FDE68A;background:#FFFBEB;border-radius:8px;font:var(--body);color:var(--text-primary);width:100%" />
    </label>`).join('')}
  </div>
  <div style="font:500 11px/1 var(--font);text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">Сезонные коэффициенты</div>
  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">
    ${MONTHS_RU.map((m, i) => `<label style="display:flex;flex-direction:column;gap:4px;align-items:center">
      <span style="font:400 11px/1 var(--font);color:var(--text-muted)">${m}</span>
      <input type="number" id="pe-seasonal-${i}" value="${p.seasonal[i] || 1}" min="0.1" max="3" step="0.05" style="padding:4px 6px;border:1px solid #FDE68A;background:#FFFBEB;border-radius:6px;font-size:12px;color:var(--text-primary);width:100%;text-align:center" />
    </label>`).join('')}
  </div>
  <p style="font:400 11px/1.4 var(--font);color:var(--text-muted);margin-top:10px">Данные сохраняются в браузере.</p>
</div>`
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
  }

  function attachPlanEditorListeners(rawData, filters) {
    const wrap = document.getElementById('plan-editor-wrap')
    if (!wrap || wrap.dataset.attached) return
    wrap.dataset.attached = '1'
    const save = debounce(() => {
      const g = (id) => parseFloat(document.getElementById(id)?.value) || 0
      const newParams = {
        yearRevenue: g('pe-yearRevenue') || 101065615,
        yearOrders: g('pe-yearOrders') || 4106,
        targetAvgCheck: g('pe-targetAvgCheck') || 24612,
        targetConversion: (g('pe-targetConversion') || 52.9) / 100,
        withdrawalCap: g('pe-withdrawalCap') || 300000,
        growthPct: g('pe-growthPct') || 25,
        seasonal: MONTHS_RU.map((_, i) => parseFloat(document.getElementById(`pe-seasonal-${i}`)?.value) || 1)
      }
      try { localStorage.setItem('daraclean_plan_params', JSON.stringify(newParams)) } catch (_) {}
      if (global.SalesFunnel) {
        const updated = global.SalesFunnel.compute(rawData, filters)
        const el = qs('splan-tracker')
        if (el) renderTrackerInto(el, updated.progressTracker)
      }
    }, 500)
    wrap.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', save))
  }

  global.SalesDashboard = { renderFunnel, renderManagers, renderChannels, renderClients, renderPlan }

})(window)
