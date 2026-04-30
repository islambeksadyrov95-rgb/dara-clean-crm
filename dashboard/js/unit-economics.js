;(function (global) {
  'use strict'

  const fmt = () => global.DC && global.DC.fmt
    ? global.DC.fmt
    : {
        money: n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' ₸',
        num:   n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0),
        pct:   (n, d) => (n || 0).toFixed(d != null ? d : 1) + '%'
      }

  const el = id => document.getElementById(id)

  const kpiCard = (label, value, icon, colorClass, note) => `
    <div class="kpi-card kpi-card--${colorClass}">
      <div class="kpi-card__label">${label}<div class="kpi-card__icon">${icon}</div></div>
      <div class="kpi-card__value">${value}</div>
      ${note ? `<div class="kpi-card__computed">${note}</div>` : ''}
    </div>`

  // ─── RENDER CAC/LTV ───────────────────────────────────────────────────────
  function renderCAC () {
    const CM = global.DaraCostModel
    if (!CM) { console.error('DaraCostModel not loaded'); return }

    const result = CM.computeAll()
    const { cac, plan } = result
    const f = fmt()

    const loadingEl = el('ucac-loading')
    const contentEl = el('ucac-content')
    const kpisEl    = el('ucac-kpis')
    const tableEl   = el('ucac-table')

    // KPI cards
    if (kpisEl) {
      const ltvRatio = cac.blendedFactCAC > 0 ? (cac.ltv / cac.blendedFactCAC).toFixed(1) + 'x' : '∞'
      const ratioClass = cac.blendedFactCAC > 0 && (cac.ltv / cac.blendedFactCAC) >= 3 ? 'green' : 'red'
      kpisEl.innerHTML =
        kpiCard('LTV на клиента',       f.money(cac.ltv), '👤', 'purple', '2.5 заказа × ср.чек') +
        kpiCard('CAC blended',          cac.blendedFactCAC > 0 ? f.money(cac.blendedFactCAC) : '—', '📣', 'orange', 'только платные каналы') +
        kpiCard('LTV / CAC blended',    ltvRatio, '⚖️', ratioClass, 'норма &gt;3x') +
        kpiCard('Окупаемость клиента',  cac.blendedFactCAC > 0 ? (cac.ltv / cac.blendedFactCAC >= 3 ? '< 1 года' : '> 1 года') : '—', '⏱️', 'blue', 'при марже 4.2%')
    }

    // Channel table
    if (tableEl) {
      _renderCACTable(tableEl, cac, plan, (channelId, value) => {
        plan.channelBudgets[channelId] = Math.max(0, value)
        CM.savePlan(plan)
        renderCAC()  // re-render
      })
    }

    if (loadingEl) loadingEl.style.display = 'none'
    if (contentEl) contentEl.style.display = 'block'

    renderCAC2026()
  }

  function _renderCACTable (container, cac, plan, onBudgetChange) {
    const f = fmt()
    const CM = global.DaraCostModel
    const debounce = CM.debounce

    // Сохраняем фокус
    const activeEl = document.activeElement
    const activeId = activeEl && activeEl.dataset && activeEl.dataset.blockId
    const activeCur = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null

    const makeInput = (channelId, value) => {
      const inp = document.createElement('input')
      inp.type = 'number'
      inp.className = 'cost-input'
      inp.value = Math.round(value)
      inp.min = '0'
      inp.dataset.blockId = 'cac_' + channelId
      inp.style.cssText = `
        width:8rem;padding:5px 8px;border:1px solid #FDE68A;border-radius:6px;
        background:#FFFBEB;font-size:13px;font-variant-numeric:tabular-nums;text-align:right;
        color:var(--text-primary);outline:none;
      `
      const deb = debounce(val => onBudgetChange(channelId, parseFloat(val) || 0), 300)
      inp.addEventListener('input', e => deb(e.target.value))
      inp.addEventListener('focus', e => { e.target.style.borderColor = 'var(--accent)' })
      inp.addEventListener('blur',  e => { e.target.style.borderColor = '#FDE68A' })
      return inp
    }

    const table = document.createElement('table')
    table.className = 'data-table'
    table.innerHTML = `
      <thead>
        <tr>
          <th>Канал</th>
          <th class="num">Факт бюджет/мес</th>
          <th class="num">Обращений</th>
          <th class="num">Заказов</th>
          <th class="num">Новых</th>
          <th class="num">CAC факт</th>
          <th class="num">ПЛАН бюджет</th>
          <th class="num">CAC план</th>
          <th class="num">LTV/CAC</th>
          <th class="num">Прогноз заказов</th>
        </tr>
      </thead>
      <tbody></tbody>`

    const tbody = table.querySelector('tbody')

    cac.rows.forEach(row => {
      const tr = document.createElement('tr')

      const ltvRatio = row.planCAC > 0 ? cac.ltv / row.planCAC
                     : row.factCAC > 0 ? cac.ltv / row.factCAC
                     : null

      const add = (html, isNum) => {
        const td = document.createElement('td')
        if (isNum) td.className = 'num'
        if (html instanceof HTMLElement) td.appendChild(html)
        else td.innerHTML = String(html != null ? html : '—')
        tr.appendChild(td)
      }

      const ratioHtml = ltvRatio !== null
        ? (() => {
            const cls = ltvRatio >= 10 ? 'color:#2E865F;background:#C6F4D6' : ltvRatio >= 3 ? 'color:#D97706;background:#FEF3C7' : 'color:#DC2626;background:#FEE2E2'
            return `<span style="padding:2px 7px;border-radius:20px;font-size:12px;font-weight:500;${cls}">${ltvRatio.toFixed(1)}x</span>`
          })()
        : '∞'

      add(row.label)
      add(row.factBudget > 0 ? f.money(row.factBudget) : '—', true)
      add(row.inquiries, true)
      add(row.orders, true)
      add(row.newOrders, true)
      add(row.factCAC > 0 ? f.money(row.factCAC) : '—', true)
      if (row.isPaid) {
        add(makeInput(row.id, row.planBudget), true)
      } else {
        add('—', true)
      }
      add(row.planCAC > 0 ? f.money(row.planCAC) : '—', true)
      add(ratioHtml, true)
      add(row.isPaid ? String(row.forecastOrders) : '—', true)

      tbody.appendChild(tr)
    })

    container.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'table-wrap'
    wrap.appendChild(table)
    container.appendChild(wrap)

    // Восстанавливаем фокус
    if (activeId) {
      const inp = tbody.querySelector(`input[data-block-id="${activeId}"]`)
      if (inp) {
        inp.focus()
        if (activeCur != null) {
          try { inp.setSelectionRange(activeCur, activeCur) } catch (e) { /**/ }
        }
      }
    }
  }

  // ─── Chart registry ───────────────────────────────────────────────────────
  let uCharts = []
  const destroyUCharts = () => { uCharts.forEach(c => { try { c.destroy() } catch(e){} }); uCharts = [] }
  const makeUChart = (ctx, cfg) => { const c = new Chart(ctx, cfg); uCharts.push(c); return c }

  // ─── RENDER MARKETING ─────────────────────────────────────────────────────
  function renderMarketing () {
    const CM = global.DaraCostModel
    if (!CM) { console.error('DaraCostModel not loaded'); return }

    const result = CM.computeAll()
    const { cac, plan } = result
    const f = fmt()

    const loadingEl = el('umkt-loading')
    const contentEl = el('umkt-content')
    if (loadingEl) loadingEl.style.display = 'none'
    if (!contentEl) return
    contentEl.style.display = 'block'

    destroyUCharts()

    // ── Scatter plot: Budget × ROAS by channel ──
    const scatterCtx = el('chart-umkt-scatter')
    if (scatterCtx) {
      const paidChannels = cac.rows.filter(r => r.isPaid && r.factBudget > 0)
      const colors = ['#EF4444', '#3B82F6', '#F59E0B', '#10B981', '#8B5CF6']
      const datasets = paidChannels.map((ch, i) => {
        const roas = ch.forecastRevenue / (ch.planBudget || ch.factBudget || 1)
        return {
          label: ch.label,
          data: [{ x: ch.planBudget || ch.factBudget, y: roas }],
          backgroundColor: colors[i % colors.length],
          pointRadius: 10,
          pointHoverRadius: 14
        }
      })
      makeUChart(scatterCtx.getContext('2d'), {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 12 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const p = ctx.raw
                  return ` ${ctx.dataset.label}: бюджет ${f.money(p.x)}, ROAS ${p.y.toFixed(1)}x`
                }
              }
            }
          },
          scales: {
            x: { title: { display: true, text: 'Бюджет/мес (₸)', font: { size: 12 } }, ticks: { callback: v => (v / 1000).toFixed(0) + 'K', font: { size: 11 } } },
            y: { title: { display: true, text: 'ROAS (x)', font: { size: 12 } }, ticks: { font: { size: 11 } }, beginAtZero: true }
          }
        }
      })
    }

    // ── Budget simulator ──
    const simEl = el('umkt-simulator')
    if (simEl) {
      const debounce = CM.debounce
      const paidChannels = cac.rows.filter(r => r.isPaid)
      const totalFactBudget = paidChannels.reduce((s, r) => s + r.factBudget, 0)
      const totalPlanBudget = paidChannels.reduce((s, r) => s + r.planBudget, 0)
      const totalForecastOrders = paidChannels.reduce((s, r) => s + r.forecastOrders, 0)
      const totalForecastRevenue = paidChannels.reduce((s, r) => s + r.forecastRevenue, 0)
      const totalROAS = totalPlanBudget > 0 ? totalForecastRevenue / totalPlanBudget : 0

      const rows = paidChannels.map(ch => {
        const roas = (ch.planBudget || ch.factBudget) > 0
          ? (ch.forecastRevenue / (ch.planBudget || ch.factBudget)).toFixed(1)
          : '—'
        return `<tr>
          <td><strong>${ch.label}</strong></td>
          <td class="num">${f.money(ch.factBudget)}</td>
          <td class="num">
            <input type="number" data-ch="${ch.id}" value="${Math.round(ch.planBudget)}" min="0"
              style="width:7rem;padding:4px 6px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:right;font-variant-numeric:tabular-nums">
          </td>
          <td class="num">${ch.forecastOrders}</td>
          <td class="num">${f.money(ch.forecastRevenue)}</td>
          <td class="num"><span class="badge badge--${parseFloat(roas) >= 5 ? 'good' : parseFloat(roas) >= 2 ? 'warn' : 'bad'}">${roas}x</span></td>
        </tr>`
      }).join('')

      simEl.innerHTML = `
        <div class="card__title">Симулятор распределения бюджета</div>
        <div class="kpi-grid kpi-grid--4" style="margin-bottom:16px">
          ${kpiCard('Общий бюджет/мес', f.money(totalPlanBudget), '💰', 'orange', '')}
          ${kpiCard('Прогноз заказов/мес', f.num(totalForecastOrders), '📦', 'blue', '')}
          ${kpiCard('Прогноз выручки/мес', f.money(totalForecastRevenue), '📈', 'green', '')}
          ${kpiCard('ROAS общий', totalROAS.toFixed(1) + 'x', '⚡', totalROAS >= 5 ? 'green' : 'orange', '')}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Канал</th><th class="num">Факт бюджет</th><th class="num">План бюджет</th>
              <th class="num">Прогноз заказов</th><th class="num">Прогноз выручки</th><th class="num">ROAS</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="font-weight:600">
              <td>ИТОГО</td><td class="num">${f.money(totalFactBudget)}</td><td class="num">${f.money(totalPlanBudget)}</td>
              <td class="num">${f.num(totalForecastOrders)}</td><td class="num">${f.money(totalForecastRevenue)}</td>
              <td class="num">${totalROAS.toFixed(1)}x</td>
            </tr></tfoot>
          </table>
        </div>`

      // Bind inputs
      setTimeout(() => {
        simEl.querySelectorAll('input[data-ch]').forEach(inp => {
          const deb = debounce(val => {
            plan.channelBudgets[inp.dataset.ch] = Math.max(0, parseFloat(val) || 0)
            CM.savePlan(plan)
            renderMarketing()
          }, 400)
          inp.addEventListener('input', e => deb(e.target.value))
          inp.addEventListener('focus', e => { e.target.style.borderColor = 'var(--accent)' })
          inp.addEventListener('blur', e => { e.target.style.borderColor = '#FDE68A' })
        })
      }, 30)
    }
  }

  // ─── RENDER GROWTH 2026-2028 ──────────────────────────────────────────────
  function renderGrowth () {
    const SE = global.ScenarioEngine
    const FD = global.FinanceData
    if (!SE || !FD) { console.error('ScenarioEngine or FinanceData not loaded'); return }

    const f = fmt()
    const T = FD.TOTALS_2025
    const growthData = SE.computeGrowthPlan(T)

    const loadingEl = el('ugr-loading')
    const contentEl = el('ugr-content')
    if (loadingEl) loadingEl.style.display = 'none'
    if (!contentEl) return
    contentEl.style.display = 'block'

    destroyUCharts()

    // CAGR calculation
    const lastYear = growthData[growthData.length - 1]
    const cagr = lastYear
      ? (Math.pow(lastYear.revenue / T.revenue, 1 / 3) - 1) * 100
      : 0

    // ── Table ──
    const tableEl = el('ugr-table')
    if (tableEl) {
      const fmtC = n => {
        if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
        if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K'
        return String(Math.round(n))
      }

      tableEl.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>Показатель</th>
            <th class="num">2025 факт</th>
            ${growthData.map(g => `<th class="num">${g.year} план</th>`).join('')}
            <th class="num">CAGR</th>
          </tr></thead>
          <tbody>
            <tr>
              <td><strong>Выручка</strong></td>
              <td class="num">${fmtC(T.revenue)} ₸</td>
              ${growthData.map(g => `<td class="num" style="color:#10B981;font-weight:600">${fmtC(g.revenue)} ₸</td>`).join('')}
              <td class="num"><span class="badge badge--good">+${cagr.toFixed(1)}%</span></td>
            </tr>
            <tr>
              <td><strong>Себестоимость</strong></td>
              <td class="num">${fmtC(T.totalCogs)} ₸</td>
              ${growthData.map(g => `<td class="num">${fmtC(g.cogs)} ₸</td>`).join('')}
              <td class="num">—</td>
            </tr>
            <tr>
              <td><strong>Валовая прибыль</strong></td>
              <td class="num" style="color:${T.grossProfit > 0 ? '#10B981' : '#DC2626'}">${fmtC(T.grossProfit)} ₸</td>
              ${growthData.map(g => `<td class="num" style="color:${g.profit > 0 ? '#10B981' : '#DC2626'};font-weight:600">${fmtC(g.profit)} ₸</td>`).join('')}
              <td class="num">—</td>
            </tr>
            <tr>
              <td><strong>Маржа</strong></td>
              <td class="num"><span class="badge badge--bad">${(T.margin * 100).toFixed(1)}%</span></td>
              ${growthData.map(g => {
                const cls = g.margin >= 20 ? 'good' : g.margin >= 10 ? 'warn' : 'bad'
                return `<td class="num"><span class="badge badge--${cls}">${g.margin.toFixed(1)}%</span></td>`
              }).join('')}
              <td class="num">—</td>
            </tr>
            <tr>
              <td>Заказов/год</td>
              <td class="num">~4 106</td>
              ${growthData.map(g => `<td class="num">${f.num(g.orders)}</td>`).join('')}
              <td class="num">—</td>
            </tr>
            <tr>
              <td>Средний чек</td>
              <td class="num">24 612 ₸</td>
              ${growthData.map(g => `<td class="num">${f.money(g.avgCheck)}</td>`).join('')}
              <td class="num">—</td>
            </tr>
            <tr>
              <td>Себест./кв.м.</td>
              <td class="num">${f.num(Math.round(T.totalCogs / (global.DaraCostModel && global.DaraCostModel.loadPlan().totalSqm || 101000)))} ₸</td>
              ${growthData.map(g => {
                const totalSqm = global.DaraCostModel && global.DaraCostModel.loadPlan().totalSqm || 101000
                const scaledSqm = Math.round(totalSqm * (g.revenue / T.revenue))
                return `<td class="num">${f.num(Math.round(g.cogs / scaledSqm))} ₸</td>`
              }).join('')}
              <td class="num">—</td>
            </tr>
          </tbody>
        </table>`
    }

    // ── Multi-line chart ──
    const chartCtx = el('chart-ugr-growth')
    if (chartCtx) {
      const years = ['2025', ...growthData.map(g => String(g.year))]
      makeUChart(chartCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [
            {
              label: 'Выручка',
              data: [T.revenue, ...growthData.map(g => g.revenue)],
              borderColor: '#10B981',
              backgroundColor: 'rgba(16,185,129,0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 5,
              pointBackgroundColor: '#10B981'
            },
            {
              label: 'Себестоимость',
              data: [T.totalCogs, ...growthData.map(g => g.cogs)],
              borderColor: '#EF4444',
              backgroundColor: 'rgba(239,68,68,0.05)',
              fill: true,
              tension: 0.3,
              pointRadius: 5,
              pointBackgroundColor: '#EF4444'
            },
            {
              label: 'Прибыль',
              data: [T.grossProfit, ...growthData.map(g => g.profit)],
              borderColor: '#8280FF',
              backgroundColor: 'rgba(130,128,255,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: 5,
              pointBackgroundColor: '#8280FF'
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${f.money(ctx.raw)}` } }
          },
          scales: {
            y: { ticks: { callback: v => (v / 1e6).toFixed(0) + 'M ₸', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
            x: { ticks: { font: { size: 12 } } }
          }
        }
      })
    }
  }

  // ─── CAC 2026 Q1 ─────────────────────────────────────────────────────────
  // Источник: DDS 2026 (dashboard-data.json) + расчёт заказов через выручку
  // Каналы: Google Ads + 2ГИС (единственные платные каналы в Q1 2026)
  // Заказы оценочно: Выручка / Ср.чек 2026 (~33 273 ₸ = 27 573 × 1.206 revenueScale)
  const CAC_2026 = {
    avgCheck: 33_273,        // 27 573 ₸ × 1.206 (revenueScale Q1 2026 vs Q1 2025)
    avgOrdersLifetime: 2.5,
    newPct: 0.635,           // 63.5% новых — из данных апреля 2025 (286 новых / 450 заказов)

    months: [
      {
        label: 'Январь',
        mktSpend: 696_034,   // Google 676 034 + 2GIS 20 000
        revenue: 5_130_618,
        channels: { google: 676_034, twoGis: 20_000 }
      },
      {
        label: 'Февраль',
        mktSpend: 789_413,   // Google 485 261 + 2GIS 304 152
        revenue: 6_371_463,
        channels: { google: 485_261, twoGis: 304_152 }
      },
      {
        label: 'Март',
        mktSpend: 779_042,   // Google 474 890 + 2GIS 304 152
        revenue: 7_160_577,
        channels: { google: 474_890, twoGis: 304_152 }
      }
    ]
  }

  function renderCAC2026 () {
    const f = fmt()
    const d = CAC_2026
    const ltv = Math.round(d.avgCheck * d.avgOrdersLifetime)

    // Вычисляем помесячные данные
    const rows = d.months.map(m => {
      const orders    = Math.round(m.revenue / d.avgCheck)
      const newOrders = Math.round(orders * d.newPct)
      const cac       = newOrders > 0 ? Math.round(m.mktSpend / newOrders) : 0
      return { ...m, orders, newOrders, cac }
    })

    const totMkt   = rows.reduce((s, r) => s + r.mktSpend, 0)
    const totOrders = rows.reduce((s, r) => s + r.orders, 0)
    const totNew    = rows.reduce((s, r) => s + r.newOrders, 0)
    const blendedCAC = totNew > 0 ? Math.round(totMkt / totNew) : 0
    const ltvCacRatio = blendedCAC > 0 ? ltv / blendedCAC : 0

    // ── KPI cards ──
    const kpisEl = el('ucac-2026-kpis')
    if (kpisEl) {
      const ratioClass = ltvCacRatio >= 10 ? 'green' : ltvCacRatio >= 3 ? 'orange' : 'red'
      const ratioLabel = ltvCacRatio >= 3 ? ltvCacRatio.toFixed(1) + 'x' : ltvCacRatio.toFixed(1) + 'x'
      kpisEl.innerHTML =
        kpiCard('LTV на клиента',      f.money(ltv),         '', 'purple', `${d.avgCheck.toLocaleString('ru-RU')} ₸ × ${d.avgOrdersLifetime} заказа`) +
        kpiCard('CAC Blended Q1',      f.money(blendedCAC),  '', 'orange', 'маркетинг / новые клиенты') +
        kpiCard('LTV / CAC',           ratioLabel,           '', ratioClass, 'норма >3x') +
        kpiCard('Маркетинг Q1 2026',   f.money(totMkt),      '', 'blue',   'Google + 2ГИС (3 мес)') +
        kpiCard('Новых клиентов Q1',   f.num(totNew),        '', 'green',  `${Math.round(d.newPct * 100)}% от ${f.num(totOrders)} заказов`) +
        kpiCard('Ср. заказов/месяц',   f.num(Math.round(totOrders / 3)), '', 'blue', 'оценка: выручка / ср.чек')
    }

    // ── Monthly table ──
    const monthlyEl = el('ucac-2026-monthly')
    if (monthlyEl) {
      const tbody = rows.map(r => {
        const cacColor = r.cac < 5000 ? 'color:#2E865F' : r.cac < 8000 ? 'color:#D97706' : 'color:#DC2626'
        return `<tr>
          <td><strong>${r.label}</strong></td>
          <td class="num">${f.money(r.mktSpend)}</td>
          <td class="num">${f.money(r.revenue)}</td>
          <td class="num">${f.num(r.orders)}</td>
          <td class="num">${f.num(r.newOrders)}</td>
          <td class="num" style="${cacColor};font-weight:600">${f.money(r.cac)}</td>
        </tr>`
      }).join('')

      const cacColor = blendedCAC < 5000 ? 'color:#2E865F' : blendedCAC < 8000 ? 'color:#D97706' : 'color:#DC2626'
      monthlyEl.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>Месяц</th>
            <th class="num">Маркетинг</th>
            <th class="num">Выручка</th>
            <th class="num">Заказов (оценка)</th>
            <th class="num">Новых (${Math.round(d.newPct * 100)}%)</th>
            <th class="num">CAC</th>
          </tr></thead>
          <tbody>
            ${tbody}
            <tr style="font-weight:600;background:var(--bg-subtle,#F9FAFB)">
              <td>ИТОГО Q1</td>
              <td class="num">${f.money(totMkt)}</td>
              <td class="num">${f.money(rows.reduce((s,r)=>s+r.revenue,0))}</td>
              <td class="num">${f.num(totOrders)}</td>
              <td class="num">${f.num(totNew)}</td>
              <td class="num" style="${cacColor};font-weight:700">${f.money(blendedCAC)}</td>
            </tr>
          </tbody>
        </table>`
    }

    // ── Channel table ──
    const channelEl = el('ucac-2026-channels')
    if (channelEl) {
      // Усредняем бюджеты каналов за Q1
      const googleAvg = Math.round(rows.reduce((s,r) => s + r.channels.google, 0) / 3)
      const twoGisAvg = Math.round(rows.reduce((s,r) => s + r.channels.twoGis, 0) / 3)
      // Доля заказов по каналам из 2025 (апрель): Google 110/218=50.5%, 2GIS 103/218=47.2%, Insta 5/218=2.3%
      // Применяем к платным заказам Q1 (~48.4% от общих = пропорция 2025)
      const paidOrdersPerMonth = Math.round((totOrders / 3) * 0.484)
      const googleOrders   = Math.round(paidOrdersPerMonth * 0.505)
      const twoGisOrders   = Math.round(paidOrdersPerMonth * 0.472)
      const googleNew      = Math.round(googleOrders * 0.90)
      const twoGisNew      = Math.round(twoGisOrders * 0.85)
      const googleCAC      = googleNew > 0 ? Math.round(googleAvg / googleNew) : 0
      const twoGisCAC      = twoGisNew > 0 ? Math.round(twoGisAvg / twoGisNew) : 0
      const blendedNew     = googleNew + twoGisNew
      const blendedBudget  = googleAvg + twoGisAvg
      const blendedCACch   = blendedNew > 0 ? Math.round(blendedBudget / blendedNew) : 0

      const makeRatioChip = cac => {
        if (cac <= 0) return '∞'
        const r = ltv / cac
        const cls = r >= 10 ? 'color:#2E865F;background:#C6F4D6' : r >= 3 ? 'color:#D97706;background:#FEF3C7' : 'color:#DC2626;background:#FEE2E2'
        return `<span style="padding:2px 7px;border-radius:20px;font-size:12px;font-weight:500;${cls}">${r.toFixed(1)}x</span>`
      }

      channelEl.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>Канал</th>
            <th class="num">Бюджет avg/мес</th>
            <th class="num">Заказов/мес (оценка)</th>
            <th class="num">Новых/мес</th>
            <th class="num">CAC</th>
            <th class="num">LTV / CAC</th>
            <th style="color:var(--text-muted);font-size:11px">Примечание</th>
          </tr></thead>
          <tbody>
            <tr>
              <td><strong>Google Ads</strong></td>
              <td class="num">${f.money(googleAvg)}</td>
              <td class="num">${googleOrders}</td>
              <td class="num">${googleNew}</td>
              <td class="num" style="font-weight:600">${f.money(googleCAC)}</td>
              <td class="num">${makeRatioChip(googleCAC)}</td>
              <td style="font-size:12px;color:var(--text-muted)">90% новых, доля 50.5%</td>
            </tr>
            <tr>
              <td><strong>2ГИС</strong></td>
              <td class="num">${f.money(twoGisAvg)}</td>
              <td class="num">${twoGisOrders}</td>
              <td class="num">${twoGisNew}</td>
              <td class="num" style="font-weight:600">${f.money(twoGisCAC)}</td>
              <td class="num">${makeRatioChip(twoGisCAC)}</td>
              <td style="font-size:12px;color:var(--text-muted)">85% новых, доля 47.2%</td>
            </tr>
            <tr style="font-weight:600;background:var(--bg-subtle,#F9FAFB)">
              <td>Blended (платные)</td>
              <td class="num">${f.money(blendedBudget)}</td>
              <td class="num">${googleOrders + twoGisOrders}</td>
              <td class="num">${blendedNew}</td>
              <td class="num" style="font-weight:700">${f.money(blendedCACch)}</td>
              <td class="num">${makeRatioChip(blendedCACch)}</td>
              <td style="font-size:12px;color:var(--text-muted)">заказы: пропорция 2025</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">
          * Заказы по каналам — оценка на основе пропорций апреля 2025. Точные данные — из CRM по каждому месяцу.
        </div>`
    }
  }

  global.UnitEconomics = { renderCAC, renderMarketing, renderGrowth }

})(window)
