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

  global.UnitEconomics = { renderCAC, renderMarketing, renderGrowth }

})(window)
