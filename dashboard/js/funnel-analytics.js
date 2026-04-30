;(function (global) {
  'use strict'

  // ─── ДАННЫЕ ─────────────────────────────────────────────────────────────────
  const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
  const MONTHS_FULL  = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

  // Доля маркетинга в COGS (факт 2025)
  const MKT_SHARE = 16_815_222 / 95_878_810   // ≈ 17.54%
  const NEW_CLI_PCT = 0.635                     // 63.5% заказов — новые клиенты

  // Фактические заказы H2 из «Кол-во Кв.м_Заказов_Ср.чек» (Excel)
  // H1 = 4106 - (404+549+793+715+574+766) = 305, распределяем пропорционально выручке
  const ORDERS_H2 = [null, null, null, null, null, null, 404, 549, 793, 715, 574, 766]

  function buildMonthlyData () {
    const fd  = global.DaraFinanceData
    const cm  = global.DaraCostModel
    if (!fd || !cm) return null

    const monthly  = fd.getMonthlyData(2025)
    const revenue  = monthly.revenue   // 12 значений
    const opExp    = monthly.opExpense

    // Маркетинг пропорционально opExpense
    const marketing = opExp.map(v => Math.round(v * MKT_SHARE))

    // Заказы: H2 из Excel, H1 через пропорцию к выручке
    const H1_revenue = revenue.slice(0, 6).reduce((s, v) => s + v, 0)
    const H1_orders  = 4_106 - ORDERS_H2.filter(Boolean).reduce((s, v) => s + v, 0) // 305
    const orders = revenue.map((rev, i) => {
      if (ORDERS_H2[i] !== null) return ORDERS_H2[i]
      return Math.max(1, Math.round(H1_orders * rev / H1_revenue))
    })

    const avgCheck = revenue.map((rev, i) => Math.round(rev / orders[i]))
    const cac      = marketing.map((mkt, i) => {
      const newOrders = Math.max(1, Math.round(orders[i] * NEW_CLI_PCT))
      return Math.round(mkt / newOrders)
    })
    const ltv = revenue.map(() => cm.FACTS.ltv)

    return { revenue, marketing, orders, avgCheck, cac, ltv }
  }

  // ─── ФОРМАТИРОВАНИЕ ─────────────────────────────────────────────────────────
  const money  = n => (n == null ? '—' : '₸\u00a0' + Math.round(n).toLocaleString('ru'))
  const num    = n => (n == null ? '—' : Math.round(n).toLocaleString('ru'))
  const pct    = n => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%')
  const delta  = (cur, prev) => prev ? ((cur - prev) / prev * 100) : 0

  // ─── ПЛАН (localStorage) ────────────────────────────────────────────────────
  const PLAN_KEY = 'dara_funnel_plan'
  function loadPlan () {
    try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || {} } catch { return {} }
  }
  function savePlan (p) {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)) } catch {}
  }

  // ─── СОСТОЯНИЕ ──────────────────────────────────────────────────────────────
  let _data      = null
  let _selMonth  = 'all'   // 'all' или 0..11
  let _charts    = []

  function destroyCharts () {
    _charts.forEach(c => { try { c.destroy() } catch {} })
    _charts = []
  }

  // ─── ГЛАВНЫЙ РЕНДЕР ─────────────────────────────────────────────────────────
  function renderFunnel () {
    const loadEl    = document.getElementById('funnel-loading')
    const contentEl = document.getElementById('funnel-content')
    if (loadEl)    loadEl.style.display    = 'none'
    if (contentEl) contentEl.style.display = 'block'

    _data = buildMonthlyData()
    if (!_data) {
      if (contentEl) contentEl.innerHTML = '<div class="empty-state"><div class="empty-state__title">Данные недоступны</div></div>'
      return
    }

    // Инжектируем всю разметку страницы
    contentEl.innerHTML = buildPageHTML()
    attachTabListeners()
    renderCurrentView()
  }

  // ─── HTML СКЕЛЕТ СТРАНИЦЫ ───────────────────────────────────────────────────
  function buildPageHTML () {
    return `
<div class="fa-header">
  <div>
    <h2 class="fa-title">Сквозная аналитика — Воронка продаж</h2>
    <p class="fa-subtitle">Маркетинг → Продажи → CAC → Ср.чек → LTV · Факт 2025</p>
  </div>
</div>

<!-- СЕЛЕКТОР МЕСЯЦА -->
<div class="fa-tabs" id="fa-tabs">
  <button class="fa-tab ${_selMonth === 'all' ? 'fa-tab--active' : ''}" data-m="all">Все месяцы</button>
  ${MONTHS_SHORT.map((m, i) => `<button class="fa-tab ${_selMonth === i ? 'fa-tab--active' : ''}" data-m="${i}">${m}</button>`).join('')}
</div>

<!-- KPI СТРОКА -->
<div class="fa-kpis" id="fa-kpis"></div>

<!-- ВОРОНКА / СРАВНЕНИЕ -->
<div id="fa-main"></div>

<!-- ПЛАНОВАЯ ВОРОНКА -->
<div class="card" style="margin-top:20px">
  <div class="card__title" style="display:flex;align-items:center;gap:10px">
    <span>📐 Плановая воронка</span>
    <span style="font-size:12px;font-weight:400;color:var(--text-muted)">— задайте целевые значения и сравните с фактом</span>
  </div>
  <div id="fa-plan"></div>
</div>
`
  }

  // ─── ТАБЫ ───────────────────────────────────────────────────────────────────
  function attachTabListeners () {
    document.querySelectorAll('.fa-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.m
        _selMonth = m === 'all' ? 'all' : parseInt(m)
        document.querySelectorAll('.fa-tab').forEach(b => b.classList.toggle('fa-tab--active', b.dataset.m === m))
        renderCurrentView()
      })
    })
  }

  function renderCurrentView () {
    destroyCharts()
    renderKPIs()
    const mainEl = document.getElementById('fa-main')
    if (!mainEl) return
    if (_selMonth === 'all') {
      mainEl.innerHTML = buildAllMonthsHTML()
      mountAllMonthsCharts()
    } else {
      mainEl.innerHTML = buildSingleMonthHTML(_selMonth)
    }
    renderPlan()
  }

  // ─── KPI КАРТОЧКИ ───────────────────────────────────────────────────────────
  function renderKPIs () {
    const el = document.getElementById('fa-kpis')
    if (!el) return

    let mkt, ord, cac, chk, ltv

    if (_selMonth === 'all') {
      mkt = _data.marketing.reduce((s, v) => s + v, 0)
      ord = _data.orders.reduce((s, v) => s + v, 0)
      const totalMkt = mkt
      const newOrd   = Math.round(ord * NEW_CLI_PCT)
      cac = newOrd > 0 ? Math.round(totalMkt / newOrd) : 0
      chk = Math.round(_data.revenue.reduce((s, v) => s + v, 0) / ord)
      ltv = _data.ltv[0]
    } else {
      const i = _selMonth
      mkt = _data.marketing[i]; ord = _data.orders[i]
      cac = _data.cac[i]; chk = _data.avgCheck[i]; ltv = _data.ltv[i]
    }

    const label = _selMonth === 'all' ? 'год 2025' : MONTHS_FULL[_selMonth]

    el.innerHTML = `
<div class="fa-kpi fa-kpi--blue">
  <div class="fa-kpi__icon">📢</div>
  <div class="fa-kpi__body">
    <div class="fa-kpi__label">Маркетинг · ${label}</div>
    <div class="fa-kpi__val">${money(mkt)}</div>
  </div>
</div>
<div class="fa-kpi fa-kpi--green">
  <div class="fa-kpi__icon">🛒</div>
  <div class="fa-kpi__body">
    <div class="fa-kpi__label">Кол-во продаж · ${label}</div>
    <div class="fa-kpi__val">${num(ord)}</div>
  </div>
</div>
<div class="fa-kpi fa-kpi--orange">
  <div class="fa-kpi__icon">🎯</div>
  <div class="fa-kpi__body">
    <div class="fa-kpi__label">CAC (стоим. клиента)</div>
    <div class="fa-kpi__val">${money(cac)}</div>
  </div>
</div>
<div class="fa-kpi fa-kpi--purple">
  <div class="fa-kpi__icon">🧾</div>
  <div class="fa-kpi__body">
    <div class="fa-kpi__label">Средний чек</div>
    <div class="fa-kpi__val">${money(chk)}</div>
  </div>
</div>
<div class="fa-kpi fa-kpi--teal">
  <div class="fa-kpi__icon">♾️</div>
  <div class="fa-kpi__body">
    <div class="fa-kpi__label">LTV на клиента</div>
    <div class="fa-kpi__val">${money(ltv)}</div>
  </div>
</div>`
  }

  // ─── ОДИНОЧНЫЙ МЕСЯЦ ────────────────────────────────────────────────────────
  function buildSingleMonthHTML (i) {
    const mkt = _data.marketing[i]
    const ord = _data.orders[i]
    const cac = _data.cac[i]
    const chk = _data.avgCheck[i]
    const ltv = _data.ltv[i]
    const newOrd = Math.round(ord * NEW_CLI_PCT)

    const stages = [
      { label: 'Маркетинг', sub: 'Бюджет на рекламу',    val: money(mkt),  badge: null,              color: '#3B82F6', icon: '📢' },
      { label: 'Продажи',   sub: `${num(newOrd)} новых из ${num(ord)} всего`, val: num(ord) + ' заказов', badge: null, color: '#10B981', icon: '🛒' },
      { label: 'CAC',       sub: 'Стоимость нового клиента', val: money(cac), badge: `${money(mkt)} / ${num(newOrd)} новых`, color: '#F59E0B', icon: '🎯' },
      { label: 'Ср. чек',  sub: 'На один заказ',          val: money(chk),  badge: `LTV / Чек = ${(ltv/chk).toFixed(1)}x`, color: '#8B5CF6', icon: '🧾' },
      { label: 'LTV',       sub: '2.5 заказа за жизнь',   val: money(ltv),  badge: `ROI = ${((ltv/cac)*100).toFixed(0)}%`, color: '#0D9488', icon: '♾️' },
    ]

    // M-o-M сравнение
    const prev = i > 0 ? {
      mkt: _data.marketing[i-1], ord: _data.orders[i-1],
      cac: _data.cac[i-1],       chk: _data.avgCheck[i-1]
    } : null

    const momRow = prev ? `
<div class="fa-mom-row">
  <span class="fa-mom__title">М/М к ${MONTHS_SHORT[i-1]}:</span>
  ${momBadge('Маркетинг', mkt, prev.mkt)}
  ${momBadge('Продажи',   ord, prev.ord)}
  ${momBadge('CAC',       cac, prev.cac, true)}
  ${momBadge('Ср.чек',    chk, prev.chk)}
</div>` : ''

    return `
<div class="card" style="margin-top:16px">
  <div class="card__title">${MONTHS_FULL[i]} 2025 — Воронка</div>
  <div class="fa-funnel-wrap">
    ${stages.map((s, si) => funnelStage(s, si, stages.length)).join('')}
  </div>
  ${momRow}
</div>`
  }

  function funnelStage (s, idx, total) {
    const widthPct = 100 - idx * (50 / (total - 1))
    return `
<div class="fa-stage" style="--stage-w:${widthPct}%;--stage-color:${s.color}">
  <div class="fa-stage__bar">
    <span class="fa-stage__icon">${s.icon}</span>
    <span class="fa-stage__label">${s.label}</span>
    <span class="fa-stage__val">${s.val}</span>
  </div>
  <div class="fa-stage__sub">${s.sub}${s.badge ? ' · <b>' + s.badge + '</b>' : ''}</div>
  ${idx < total - 1 ? '<div class="fa-stage__arrow">▼</div>' : ''}
</div>`
  }

  function momBadge (label, cur, prev, invertGood) {
    const d = delta(cur, prev)
    const good = invertGood ? d <= 0 : d >= 0
    const cls  = good ? 'fa-mom__badge--good' : 'fa-mom__badge--bad'
    return `<span class="fa-mom__badge ${cls}">${label}: ${pct(d)}</span>`
  }

  // ─── ВСЕ МЕСЯЦЫ ─────────────────────────────────────────────────────────────
  function buildAllMonthsHTML () {
    return `
<div class="content-grid content-grid--2" style="margin-top:16px">
  <div class="card">
    <div class="card__title">Маркетинг vs Продажи по месяцам</div>
    <div class="chart-wrap"><canvas id="fa-chart-mkt-ord"></canvas></div>
  </div>
  <div class="card">
    <div class="card__title">CAC и Средний чек по месяцам</div>
    <div class="chart-wrap"><canvas id="fa-chart-cac-chk"></canvas></div>
  </div>
</div>
<div class="card" style="margin-top:16px">
  <div class="card__title">Сравнение по месяцам — все показатели</div>
  ${buildComparisonTable()}
</div>`
  }

  function mountAllMonthsCharts () {
    const labels = MONTHS_SHORT

    // Chart 1: Маркетинг (bar, left axis) + Продажи (line, right axis)
    const ctx1 = document.getElementById('fa-chart-mkt-ord')
    if (ctx1) {
      _charts.push(new Chart(ctx1.getContext('2d'), {
        data: {
          labels,
          datasets: [
            {
              type: 'bar', label: 'Маркетинг (₸)', data: _data.marketing,
              backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3B82F6',
              yAxisID: 'y', order: 2
            },
            {
              type: 'line', label: 'Кол-во заказов', data: _data.orders,
              borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.1)',
              tension: 0.4, fill: false, pointRadius: 4,
              yAxisID: 'y2', order: 1
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' },
          scales: {
            y:  { position: 'left',  title: { display: true, text: 'Маркетинг (₸)' },
                  ticks: { callback: v => (v/1000).toFixed(0) + 'K' } },
            y2: { position: 'right', title: { display: true, text: 'Заказы' },
                  grid: { drawOnChartArea: false } }
          },
          plugins: { legend: { position: 'top' } }
        }
      }))
    }

    // Chart 2: CAC + Ср.чек
    const ctx2 = document.getElementById('fa-chart-cac-chk')
    if (ctx2) {
      _charts.push(new Chart(ctx2.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'CAC (₸)', data: _data.cac,
              borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.1)',
              tension: 0.4, fill: false, pointRadius: 4
            },
            {
              label: 'Средний чек (₸)', data: _data.avgCheck,
              borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.1)',
              tension: 0.4, fill: false, pointRadius: 4
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' },
          scales: { y: { ticks: { callback: v => (v/1000).toFixed(0) + 'K' } } },
          plugins: { legend: { position: 'top' } }
        }
      }))
    }
  }

  function buildComparisonTable () {
    const rows = MONTHS_SHORT.map((m, i) => {
      const prev = i > 0 ? i - 1 : null
      const dMkt = prev !== null ? delta(_data.marketing[i], _data.marketing[prev]) : null
      const dOrd = prev !== null ? delta(_data.orders[i],    _data.orders[prev])    : null
      const dCac = prev !== null ? delta(_data.cac[i],       _data.cac[prev])       : null
      const dChk = prev !== null ? delta(_data.avgCheck[i],  _data.avgCheck[prev])  : null

      return `
<tr>
  <td><b>${MONTHS_FULL[i]}</b></td>
  <td>${money(_data.marketing[i])}</td>
  <td>${num(_data.orders[i])}</td>
  <td>${money(_data.cac[i])} ${dCac !== null ? deviationBadge(dCac, true) : ''}</td>
  <td>${money(_data.avgCheck[i])} ${dChk !== null ? deviationBadge(dChk) : ''}</td>
  <td>${money(_data.ltv[i])}</td>
  <td>${dMkt !== null ? deviationBadge(dMkt) : '<span class="fa-dev fa-dev--neu">—</span>'}</td>
  <td>${dOrd !== null ? deviationBadge(dOrd) : '<span class="fa-dev fa-dev--neu">—</span>'}</td>
</tr>`
    })

    return `
<div class="fa-table-wrap">
<table class="data-table fa-table">
  <thead>
    <tr>
      <th>Месяц</th>
      <th>Маркетинг</th>
      <th>Заказов</th>
      <th>CAC</th>
      <th>Ср. чек</th>
      <th>LTV</th>
      <th>М/М маркетинг</th>
      <th>М/М заказы</th>
    </tr>
  </thead>
  <tbody>${rows.join('')}</tbody>
  <tfoot>
    <tr style="font-weight:700;background:var(--bg-page)">
      <td>ИТОГО / Ср.</td>
      <td>${money(_data.marketing.reduce((s,v)=>s+v,0))}</td>
      <td>${num(_data.orders.reduce((s,v)=>s+v,0))}</td>
      <td>${money(_data.cac.reduce((s,v)=>s+v,0)/_data.cac.length)}</td>
      <td>${money(_data.avgCheck.reduce((s,v)=>s+v,0)/_data.avgCheck.length)}</td>
      <td>${money(_data.ltv[0])}</td>
      <td>—</td><td>—</td>
    </tr>
  </tfoot>
</table>
</div>`
  }

  function deviationBadge (d, invertGood) {
    const good = invertGood ? d <= 0 : d >= 0
    return `<span class="fa-dev ${good ? 'fa-dev--good' : 'fa-dev--bad'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span>`
  }

  // ─── ПЛАНОВАЯ ВОРОНКА ───────────────────────────────────────────────────────
  function renderPlan () {
    const el = document.getElementById('fa-plan')
    if (!el) return

    const plan = loadPlan()
    const idx  = _selMonth === 'all' ? null : _selMonth

    // Defaults: берём факт текущего месяца (или среднее за год)
    const defMkt = idx !== null ? _data.marketing[idx] : Math.round(_data.marketing.reduce((s,v)=>s+v,0)/12)
    const defOrd = idx !== null ? _data.orders[idx]    : Math.round(_data.orders.reduce((s,v)=>s+v,0)/12)
    const defChk = idx !== null ? _data.avgCheck[idx]  : _data.avgCheck[0]
    const defLtv = _data.ltv[0]

    const pMkt = plan.marketing ?? defMkt
    const pOrd = plan.orders    ?? defOrd
    const pChk = plan.avgCheck  ?? defChk
    const pLtv = plan.ltv       ?? defLtv

    const pNewOrd = Math.max(1, Math.round(pOrd * NEW_CLI_PCT))
    const pCac    = Math.round(pMkt / pNewOrd)
    const pRev    = Math.round(pOrd * pChk)

    // Фактические для сравнения
    const fMkt = idx !== null ? _data.marketing[idx] : Math.round(_data.marketing.reduce((s,v)=>s+v,0)/12)
    const fOrd = idx !== null ? _data.orders[idx]    : Math.round(_data.orders.reduce((s,v)=>s+v,0)/12)
    const fCac = idx !== null ? _data.cac[idx]       : Math.round(_data.cac.reduce((s,v)=>s+v,0)/12)
    const fChk = idx !== null ? _data.avgCheck[idx]  : Math.round(_data.avgCheck.reduce((s,v)=>s+v,0)/12)

    el.innerHTML = `
<div class="fa-plan-grid">
  <div class="fa-plan-inputs">
    <div class="fa-plan__subtitle">Введите плановые значения:</div>
    ${planInput('marketing', 'Маркетинг (₸/мес)', pMkt, plan, '📢')}
    ${planInput('orders',    'Кол-во продаж',       pOrd, plan, '🛒')}
    ${planInput('avgCheck',  'Средний чек (₸)',      pChk, plan, '🧾')}
    ${planInput('ltv',       'LTV (₸)',              pLtv, plan, '♾️')}
    <div class="fa-plan__computed">
      <span>Расчётный CAC:</span> <b>${money(pCac)}</b>
      &nbsp;|&nbsp;
      <span>Ожидаемая выручка:</span> <b>${money(pRev)}</b>
    </div>
    <button class="fa-plan__reset" id="fa-plan-reset">↩ Сбросить к факту</button>
  </div>

  <div class="fa-plan-compare">
    <div class="fa-plan__subtitle">Факт vs План${idx !== null ? ' · ' + MONTHS_FULL[idx] : ' (среднее/мес)'}:</div>
    <table class="data-table" style="margin-top:8px">
      <thead><tr><th>Метрика</th><th>Факт</th><th>План</th><th>Отклонение</th></tr></thead>
      <tbody>
        ${planRow('Маркетинг',  fMkt, pMkt, false)}
        ${planRow('Заказы',     fOrd, pOrd, false)}
        ${planRow('CAC',        fCac, pCac, true)}
        ${planRow('Ср. чек',   fChk, pChk, false)}
        ${planRow('LTV',        defLtv, pLtv, false)}
      </tbody>
    </table>
  </div>
</div>`

    attachPlanListeners(plan)
  }

  function planInput (key, label, val, plan, icon) {
    return `
<div class="fa-plan-input-row">
  <span class="fa-plan-input__icon">${icon}</span>
  <label class="fa-plan-input__label">${label}</label>
  <input class="fa-plan-input__field" type="number" data-key="${key}" value="${val}" min="0" step="1000">
</div>`
  }

  function planRow (label, fact, plan, invertGood) {
    const d = delta(plan, fact)
    const good = invertGood ? d <= 0 : d >= 0
    const cls  = good ? 'fa-dev--good' : 'fa-dev--bad'
    const isNum = label === 'Заказы'
    const fFmt = isNum ? num(fact) : money(fact)
    const pFmt = isNum ? num(plan) : money(plan)
    return `<tr>
      <td>${label}</td>
      <td>${fFmt}</td>
      <td>${pFmt}</td>
      <td><span class="fa-dev ${cls}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span></td>
    </tr>`
  }

  function attachPlanListeners (plan) {
    document.querySelectorAll('.fa-plan-input__field').forEach(inp => {
      inp.addEventListener('change', () => {
        plan[inp.dataset.key] = parseFloat(inp.value) || 0
        savePlan(plan)
        renderPlan()
      })
    })
    const resetBtn = document.getElementById('fa-plan-reset')
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        savePlan({})
        renderPlan()
      })
    }
  }

  // ─── ЭКСПОРТ ─────────────────────────────────────────────────────────────────
  global.FunnelAnalytics = { renderFunnel }

})(window)
