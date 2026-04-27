;(function (global) {
  'use strict'

  const fmt = () => global.DC && global.DC.fmt
    ? global.DC.fmt
    : {
        money: n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' ₸',
        num:   n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0),
        pct:   (n, d) => (n || 0).toFixed(d != null ? d : 1) + '%'
      }

  // ─── Chart registry (destroy перед re-render) ─────────────────────────────
  let costCharts = []
  const destroyCostCharts = () => {
    costCharts.forEach(c => { try { c.destroy() } catch (e) { /**/ } })
    costCharts = []
  }
  const makeChart = (ctx, cfg) => {
    const c = new Chart(ctx, cfg)
    costCharts.push(c)
    return c
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const el = id => document.getElementById(id)

  const kpiCard = (label, value, icon, colorClass, delta, note) => `
    <div class="kpi-card kpi-card--${colorClass}">
      <div class="kpi-card__label">
        ${label}
        <div class="kpi-card__icon">${icon}</div>
      </div>
      <div class="kpi-card__value">${value}</div>
      ${delta ? `<div class="kpi-card__delta">${delta}</div>` : ''}
      ${note ? `<div class="kpi-card__computed">${note}</div>` : ''}
    </div>`

  const badge = (pct) => {
    if (pct == null || !isFinite(pct)) return ''
    const a = Math.abs(pct)
    const cls = a <= 5 ? 'good' : a <= 15 ? 'warn' : 'bad'
    const sign = pct >= 0 ? '+' : ''
    return `<span class="badge badge--${cls}">${sign}${pct.toFixed(1)}%</span>`
  }

  const formatCompact = n => {
    const a = Math.abs(n || 0)
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M ₸'
    if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K ₸'
    return Math.round(n || 0) + ' ₸'
  }

  // ─── RENDER COST PAGE ─────────────────────────────────────────────────────
  function renderCost () {
    const CM = global.DaraCostModel
    if (!CM) {
      console.error('DaraCostModel not loaded')
      return
    }

    const loadingEl  = el('cost-loading')
    const contentEl  = el('cost-content')
    const kpisEl     = el('cost-kpis')
    const breakEvenEl = el('cost-breakeven')
    const editTableEl = el('cost-edit-table')

    const result = CM.computeAll()
    const { cost, cac, breakeven, plan } = result
    const F = CM.FACTS
    const f = fmt()

    destroyCostCharts()

    // ── KPI Cards ────────────────────────────────────────────────────────────
    if (kpisEl) {
      const marginClass = cost.planMargin >= 0.20 ? 'green' : cost.planMargin >= 0.10 ? 'orange' : 'red'
      kpisEl.innerHTML =
        kpiCard('Себестоимость 1 кв.м.', Math.round(cost.planCostPerSqm) + ' ₸',   '📦', 'orange',  null, `факт: ${Math.round(cost.factCostPerSqm)} ₸`) +
        kpiCard('Себестоимость 1 заказа', f.money(cost.planCostPerOrder),            '🔧', 'orange',  null, `факт: ${f.money(cost.factCostPerOrder)}`) +
        kpiCard('Средний чек',            f.money(cost.planPrice),                   '💰', 'purple',  null, `факт: ${f.money(F.avgCheck)}`) +
        kpiCard('Прибыль на заказ',       f.money(cost.planProfitPerOrder),           '📈', cost.planProfitPerOrder > 0 ? 'green' : 'red', null, `факт: ${f.money(cost.factProfitPerOrder)}`) +
        kpiCard('Валовая маржа',          f.pct(cost.planMargin * 100),               '🎯', marginClass, null, 'норма клининга 25–35%')
    }

    // ── Methodology panel ─────────────────────────────────────────────────────
    const methEl = el('cost-methodology')
    if (methEl && CM.FACT_SOURCES) {
      const S = CM.FACT_SOURCES
      methEl.innerHTML = `
        <div class="card">
          <div class="card__title" style="cursor:pointer" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
            Методология расчёта (нажмите чтобы раскрыть)
          </div>
          <div style="font-size:13px;line-height:1.6;color:var(--text-secondary)">
            <div style="margin-bottom:12px">
              <strong>Источник данных:</strong> ${S.dataSource}
            </div>
            <div style="margin-bottom:8px">
              <strong>Кв.м. (${f.num(F.totalSqm)}):</strong> ${S.totalSqm}
            </div>
            <div style="margin-bottom:8px">
              <strong>Заказы (${f.num(F.totalOrders)}):</strong> ${S.totalOrders}
            </div>
            <div style="margin-bottom:8px">
              <strong>Средний чек (${f.money(F.avgCheck)}):</strong> ${S.avgCheck}
            </div>
            <div style="margin-bottom:8px">
              <strong>Постоянные расходы:</strong> ${S.fixedCostsYear}
            </div>
            <div style="margin-bottom:8px">
              <strong>Переменные на заказ:</strong> ${S.variablePerOrder}
            </div>
            <div style="margin-top:12px;border-top:1px solid rgba(0,0,0,.06);padding-top:12px">
              <strong>Что входит в каждый блок:</strong>
              <ul style="margin:8px 0;padding-left:20px">
                ${CM.BLOCK_KEYS.map(k => `<li><strong>${F.blocks[k].label}:</strong> ${S.blocks[k]}</li>`).join('')}
              </ul>
            </div>
          </div>
        </div>`
    }

    // ── Stacked Bar Chart ─────────────────────────────────────────────────────
    const chartCtx = el('chart-cost-bar')
    if (chartCtx) {
      const datasets = CM.BLOCK_KEYS.map(k => {
        const row = cost.blockRows.find(r => r.key === k)
        return {
          label: row.label,
          data: [row.planAmt],
          backgroundColor: row.color,
          borderWidth: 0
        }
      })
      makeChart(chartCtx.getContext('2d'), {
        type: 'bar',
        data: { labels: ['Себестоимость 2025'], datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const row = cost.blockRows[ctx.datasetIndex]
                  const pct = (row.planAmt / cost.planTotalCogs * 100).toFixed(1)
                  return ` ${ctx.dataset.label}: ${f.money(ctx.raw)} (${pct}%)`
                }
              }
            }
          },
          scales: {
            x: { stacked: true, beginAtZero: true, ticks: { display: false }, grid: { display: false }, border: { display: false } },
            y: { stacked: true, ticks: { display: false }, grid: { display: false }, border: { display: false } }
          }
        }
      })
    }

    // ── Break-even Panel ──────────────────────────────────────────────────────
    if (breakEvenEl) {
      const be = breakeven
      const safetyColor = be.safetyColor === 'good' ? 'var(--color-income)' : be.safetyColor === 'warn' ? 'var(--color-warning)' : 'var(--color-expense)'
      const safetyBg = be.safetyColor === 'good' ? 'var(--color-income-bg)' : be.safetyColor === 'warn' ? 'var(--color-warning-bg)' : 'var(--color-expense-bg)'
      breakEvenEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px">Постоянные расходы/год</div>
              <div style="font-size:20px;font-weight:700">${f.money(be.fixedCostsYear)}</div>
            </div>
            <div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px">Перем. на заказ</div>
              <div style="font-size:20px;font-weight:700">${f.money(be.variablePerOrder)}</div>
            </div>
            <div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px">Маржа покрытия</div>
              <div style="font-size:20px;font-weight:700">${f.money(be.contributionMarginFact)}</div>
            </div>
            <div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px">Break-even (мес)</div>
              <div style="font-size:20px;font-weight:700">${be.beOrdersMonthFact ? Math.round(be.beOrdersMonthFact) + ' зак.' : '—'}</div>
            </div>
          </div>
          <div style="padding:12px;border-radius:8px;background:${safetyBg};border:1px solid ${safetyColor}">
            <div style="font-size:12px;font-weight:600;color:${safetyColor};margin-bottom:4px">Запас прочности: ${be.safetyPct != null ? f.pct(be.safetyPct) : '—'}</div>
            <div style="font-size:12px;color:var(--text-secondary)">
              Факт ${be.factOrdersMonth} зак/мес vs break-even ${be.beOrdersMonthFact ? Math.round(be.beOrdersMonthFact) : '—'} зак/мес. Норма &gt;20%.
            </div>
          </div>
          <div class="chart-wrap" style="height:80px;margin-top:4px">
            <canvas id="chart-cost-breakeven-bar"></canvas>
          </div>
        </div>`

      // Render breakeven bar chart (after injecting canvas into DOM)
      const beCtx = el('chart-cost-breakeven-bar')
      if (beCtx) {
        const bePoint = be.beOrdersMonthFact ? Math.round(be.beOrdersMonthFact) : 313
        const fact = be.factOrdersMonth
        makeChart(beCtx.getContext('2d'), {
          type: 'bar',
          data: {
            labels: ['Факт', 'Break-even'],
            datasets: [{
              data: [fact, bePoint],
              backgroundColor: [fact > bePoint ? '#4AD991' : '#F87171', '#9CA3AF'],
              borderRadius: 4
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
              y: { ticks: { font: { size: 11 } } }
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
              c.strokeStyle = '#DC2626'
              c.lineWidth = 2
              c.setLineDash([5, 3])
              c.beginPath(); c.moveTo(xPx, top); c.lineTo(xPx, bottom); c.stroke()
              c.restore()
            }
          }]
        })
      }
    }

    // ── Editable Cost Table ────────────────────────────────────────────────────
    if (editTableEl) {
      _renderEditTable(editTableEl, cost, plan, cac, (key, value) => {
        if (key === '__price__') {
          plan.planPrice = value > 0 ? value : 1
        } else if (key === '__sqm__') {
          plan.totalSqm = Math.max(1, value)
        } else {
          plan.planBlocks[key] = Math.max(0, value)
        }
        CM.savePlan(plan)
        renderCost()  // re-render
      })
    }

    if (loadingEl) loadingEl.style.display = 'none'
    if (contentEl) contentEl.style.display = 'block'
  }

  function _renderEditTable (container, cost, plan, cac, onPlanChange) {
    const f = fmt()
    const CM = global.DaraCostModel
    const debounce = CM.debounce

    // Запоминаем фокус
    const activeEl = document.activeElement
    const activeId = activeEl && activeEl.dataset && activeEl.dataset.blockId
    const activeCur = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null

    const makeInput = (key, value) => {
      const inp = document.createElement('input')
      inp.type = 'number'
      inp.className = 'cost-input'
      inp.value = Math.round(value)
      inp.min = '0'
      inp.dataset.blockId = key
      inp.style.cssText = `
        width:9rem;padding:5px 8px;border:1px solid #FDE68A;border-radius:6px;
        background:#FFFBEB;font-size:13px;font-variant-numeric:tabular-nums;text-align:right;
        color:var(--text-primary);transition:border-color .15s;outline:none;
      `
      const deb = debounce(val => onPlanChange(key, parseFloat(val) || 0), 300)
      inp.addEventListener('input', e => deb(e.target.value))
      inp.addEventListener('focus', e => { e.target.style.borderColor = 'var(--accent)' })
      inp.addEventListener('blur',  e => { e.target.style.borderColor = '#FDE68A' })
      return inp
    }

    const BLOCK_COLORS = {
      production: '#8B5CF6', logistics: '#F59E0B', marketing: '#3B82F6',
      sales: '#10B981', tax: '#6B7280', overhead: '#EC4899'
    }

    // Build table HTML + inputs (inputs injected after)
    const rows = []

    // Блоки
    cost.blockRows.forEach(row => {
      rows.push({
        type: 'block',
        key: row.key,
        label: row.label,
        color: row.color,
        note: row.note,
        factAmt: row.factAmt,
        factPct: row.factPct,
        factPerSqm: row.factPerSqm,
        factPerOrder: row.factPerOrder,
        planAmt: row.planAmt,
        delta: row.delta
      })
    })

    const table = document.createElement('table')
    table.className = 'data-table'
    table.innerHTML = `
      <thead>
        <tr>
          <th>Блок затрат</th>
          <th class="num">Факт 2025</th>
          <th class="num">%</th>
          <th class="num">На 1 кв.м.</th>
          <th class="num">На 1 заказ</th>
          <th class="num">ПЛАН 2026</th>
          <th class="num">Δ</th>
        </tr>
      </thead>
      <tbody id="cost-edit-tbody"></tbody>`

    container.innerHTML = ''
    const wrapper = document.createElement('div')
    wrapper.className = 'table-wrap'
    wrapper.appendChild(table)
    container.appendChild(wrapper)

    const tbody = table.querySelector('#cost-edit-tbody')

    const addRow = (label, color, note, factAmt, factPct, factPerSqm, factPerOrder, planAmtOrNode, delta, rowClass) => {
      const tr = document.createElement('tr')
      if (rowClass) tr.style.cssText = rowClass

      // Label cell
      const tdLabel = document.createElement('td')
      if (color) {
        tdLabel.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${label}${note ? `<span style="display:block;font-size:11px;color:var(--text-muted)">${note}</span>` : ''}`
      } else {
        tdLabel.innerHTML = `<strong>${label}</strong>${note ? `<span style="display:block;font-size:11px;color:var(--text-muted)">${note}</span>` : ''}`
      }
      tr.appendChild(tdLabel)

      // Fact amt
      const tdFact = document.createElement('td'); tdFact.className = 'num'
      tdFact.textContent = typeof factAmt === 'string' ? factAmt : formatCompact(factAmt)
      tr.appendChild(tdFact)

      // Fact pct
      const tdPct = document.createElement('td'); tdPct.className = 'num'
      tdPct.textContent = typeof factPct === 'string' ? factPct : f.pct(factPct * 100)
      tr.appendChild(tdPct)

      // Per sqm
      const tdSqm = document.createElement('td'); tdSqm.className = 'num'
      tdSqm.textContent = typeof factPerSqm === 'number' ? Math.round(factPerSqm) + ' ₸' : (factPerSqm || '—')
      tr.appendChild(tdSqm)

      // Per order
      const tdOrd = document.createElement('td'); tdOrd.className = 'num'
      tdOrd.textContent = typeof factPerOrder === 'number' ? Math.round(factPerOrder) + ' ₸' : (factPerOrder || '—')
      tr.appendChild(tdOrd)

      // Plan (node or text)
      const tdPlan = document.createElement('td'); tdPlan.className = 'num'
      if (planAmtOrNode instanceof HTMLElement) {
        tdPlan.appendChild(planAmtOrNode)
      } else {
        tdPlan.textContent = planAmtOrNode != null ? String(planAmtOrNode) : '—'
        if (rowClass && rowClass.includes('font-weight:700')) tdPlan.style.fontWeight = '700'
      }
      tr.appendChild(tdPlan)

      // Delta
      const tdDelta = document.createElement('td'); tdDelta.className = 'num'
      if (delta != null && isFinite(delta)) {
        const a = Math.abs(delta)
        const cls = a <= 5 ? 'color:#2E865F;background:#C6F4D6' : a <= 15 ? 'color:#D97706;background:#FEF3C7' : 'color:#DC2626;background:#FEE2E2'
        const sign = delta >= 0 ? '+' : ''
        tdDelta.innerHTML = `<span style="padding:2px 7px;border-radius:20px;font-size:12px;font-weight:500;${cls}">${sign}${delta.toFixed(1)}%</span>`
      } else {
        tdDelta.textContent = '—'
      }
      tr.appendChild(tdDelta)

      tbody.appendChild(tr)
    }

    // Block rows
    cost.blockRows.forEach(row => {
      addRow(row.label, row.color, row.note, row.factAmt, row.factPct, row.factPerSqm, row.factPerOrder, makeInput(row.key, row.planAmt), row.delta)
    })

    // Total row
    const F = CM.FACTS
    addRow(
      'ИТОГО себестоимость', null, null,
      cost.factTotalCogs, '100%', cost.factCostPerSqm, cost.factCostPerOrder,
      formatCompact(cost.planTotalCogs), cost.totalCogsDelta,
      'font-weight:700;border-top:2px solid rgba(0,0,0,.08);background:#F9FAFB'
    )

    // Price row
    addRow(
      'Цена продажи (ср.чек)', null, 'Редактируемое',
      F.avgCheck, '—', '—', '—',
      makeInput('__price__', plan.planPrice), cost.priceDelta,
      'background:#FFFBEB'
    )

    // Кв.м. row — редактируемое поле для общей площади
    const sqmInput = makeInput('__sqm__', plan.totalSqm || F.totalSqm)
    // Перехватываем изменение кв.м.
    const origHandler = sqmInput._debHandler
    sqmInput.addEventListener('input', CM.debounce(function () {
      const val = Math.max(1, parseInt(sqmInput.value) || 1)
      plan.totalSqm = val
      CM.savePlan(plan)
      renderCost()
    }, 300))
    // Убираем стандартный handler для __sqm__
    addRow(
      'Общая площадь (кв.м.)', null, 'Введите фактические кв.м. за год',
      f.num(F.totalSqm), '—', '—', '—',
      sqmInput, null,
      'background:#FFFBEB'
    )

    // Profit row
    const profitBg = cost.planProfitPerOrder < 0 ? 'background:#FEE2E2' : ''
    addRow(
      'Прибыль на заказ', null, null,
      cost.factProfitPerOrder, f.pct(cost.factMargin * 100), null, null,
      f.money(cost.planProfitPerOrder), null, profitBg
    )

    // Margin row
    const fMarginCls = cost.factMargin >= .2 ? 'color:#2E865F;background:#C6F4D6' : cost.factMargin >= .1 ? 'color:#D97706;background:#FEF3C7' : 'color:#DC2626;background:#FEE2E2'
    const pMarginCls = cost.planMargin >= .2 ? 'color:#2E865F;background:#C6F4D6' : cost.planMargin >= .1 ? 'color:#D97706;background:#FEF3C7' : 'color:#DC2626;background:#FEE2E2'
    const marginTr = document.createElement('tr')
    marginTr.innerHTML = `
      <td><strong>Валовая маржа</strong></td>
      <td class="num"><span style="padding:2px 7px;border-radius:20px;font-size:12px;font-weight:500;${fMarginCls}">${f.pct(cost.factMargin * 100)}</span></td>
      <td class="num">—</td><td class="num">—</td><td class="num">—</td>
      <td class="num"><span style="padding:2px 7px;border-radius:20px;font-size:12px;font-weight:500;${pMarginCls}">${f.pct(cost.planMargin * 100)}</span></td>
      <td class="num">—</td>`
    tbody.appendChild(marginTr)

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

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  const fmtCompact = n => {
    const a = Math.abs(n || 0)
    if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B ₸'
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M ₸'
    if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K ₸'
    return Math.round(n || 0) + ' ₸'
  }

  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  // ─── OVERVIEW ─────────────────────────────────────────────────────────────
  function renderOverview () {
    const loading = el('overview-loading')
    const content = el('overview-content')
    if (!content) return

    const FD = global.FinanceData
    if (!FD) { console.error('FinanceData not loaded'); return }
    const f = fmt()
    const d = FD.FACT_2025_MONTHLY
    const T = FD.TOTALS_2025

    destroyCostCharts()

    // ── KPI 5 cards ──────────────────────────────────────────────────────────
    const kpisEl = el('overview-kpis')
    if (kpisEl) {
      const profitColor = T.grossProfit >= 0 ? 'green' : 'red'
      kpisEl.innerHTML =
        kpiCard('Выручка 2025',          fmtCompact(T.revenue),     '💰', 'purple', null, '12 мес. факт') +
        kpiCard('Себестоимость',          fmtCompact(T.totalCogs),   '📦', 'orange', null, f.pct((T.totalCogs/T.revenue)*100) + ' от выручки') +
        kpiCard('Валовая прибыль',        fmtCompact(T.grossProfit), '📈', profitColor, null, 'до вывода средств') +
        kpiCard('Вывод собственника',     fmtCompact(T.withdrawals), '👤', 'blue',   null, 'изъято из бизнеса') +
        kpiCard('Маржинальность',         f.pct(T.margin * 100),     '🎯', T.margin >= 0.1 ? 'green' : 'red', null, 'норма клининга 25-35%')
    }

    // ── Cash Gap Alert ────────────────────────────────────────────────────────
    const gapEl = el('overview-cash-gap')
    if (gapEl) {
      const cum = d.cumulative
      const peakIdx = cum.indexOf(Math.min(...cum))
      const closureIdx = FD && global.ScenarioEngine
        ? global.ScenarioEngine.computeGapClosure(cum)
        : null
      const progressPct = closureIdx != null
        ? Math.min(100, Math.round(((12 - closureIdx) / 12) * 100))
        : 0

      gapEl.innerHTML = `
        <div class="card alert-card--gap" style="border-left:4px solid #DC2626">
          <div class="card__title" style="color:#DC2626">⚠️ Кассовый разрыв 2025</div>
          <div class="alert-card__grid">
            <div class="alert-card__item">
              <div class="alert-card__item-label">Текущий дефицит</div>
              <div class="alert-card__item-value alert-card__item-value--red">${fmtCompact(T.yearEndDeficit)}</div>
            </div>
            <div class="alert-card__item">
              <div class="alert-card__item-label">Пик дефицита</div>
              <div class="alert-card__item-value alert-card__item-value--red">${fmtCompact(T.peakDeficit)}</div>
            </div>
            <div class="alert-card__item">
              <div class="alert-card__item-label">Месяц пика</div>
              <div class="alert-card__item-value">${T.peakMonth}</div>
            </div>
            <div class="alert-card__item">
              <div class="alert-card__item-label">Убыточных месяцев</div>
              <div class="alert-card__item-value alert-card__item-value--red">${cum.filter(v => v < 0).length}</div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Прогресс закрытия разрыва</div>
          <div class="progress-bar" style="margin-bottom:8px">
            <div class="progress-bar__fill" style="width:${progressPct}%;background:#DC2626"></div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary)">
            ${closureIdx != null
              ? `Выход в 0 ожидается в ${FD.MONTHS_SHORT[closureIdx]} 2026`
              : 'Для прогноза настройте план 2026'}
          </div>
        </div>`
    }

    // ── Break-even ref ────────────────────────────────────────────────────────
    const beEl = el('overview-breakeven')
    if (beEl) {
      const CM = global.DaraCostModel
      if (CM) {
        const { breakeven } = CM.computeAll()
        const be = breakeven
        const safetyColor = be.safetyColor === 'good' ? '#2E865F' : be.safetyColor === 'warn' ? '#D97706' : '#DC2626'
        beEl.innerHTML = `
          <div class="card">
            <div class="card__title">Точка безубыточности</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;text-transform:uppercase;letter-spacing:.05em">Break-even заказов</div>
                <div style="font-size:22px;font-weight:700">${be.beOrdersMonthFact ? Math.round(be.beOrdersMonthFact) : '—'} /мес</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;text-transform:uppercase;letter-spacing:.05em">Запас прочности</div>
                <div style="font-size:22px;font-weight:700;color:${safetyColor}">${be.safetyPct != null ? f.pct(be.safetyPct) : '—'}</div>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-secondary)">Факт ${be.factOrdersMonth} зак/мес. Норма &gt;20%.</div>
          </div>`
      }
    }

    // ── Salary Rule "10th date" ─────────────────────────────────────────────
    const salaryEl = el('overview-salary-rule')
    if (salaryEl) {
      const avgFOT = 3_747_145
      const minReserve = 2_000_000
      const withdrawAfter15 = avgFOT + 1_000_000
      salaryEl.innerHTML = `
        <div class="card" style="border-left:4px solid #4880FF">
          <div class="card__title" style="color:#4880FF">📋 Правило «10-го числа» — Планирование ЗП</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:12px 0">
            <div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Средний ФОТ/мес</div>
              <div style="font-size:20px;font-weight:700">${fmtCompact(avgFOT)}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Мин. остаток на 1-е</div>
              <div style="font-size:20px;font-weight:700;color:#D97706">${fmtCompact(minReserve)}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Вывод только после 15-го</div>
              <div style="font-size:20px;font-weight:700;color:#6B7280">если &gt; ${fmtCompact(withdrawAfter15)}</div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:8px;padding:8px 12px;background:#F0F5FF;border-radius:8px">
            <strong>1–9:</strong> все поступления → фонд ЗП &nbsp;·&nbsp;
            <strong>10:</strong> выплата ЗП из фонда &nbsp;·&nbsp;
            <strong>&gt;15:</strong> вывод только при остатке &gt; ФОТ + 1M &nbsp;·&nbsp;
            <strong>Расход &gt;100K:</strong> запись в план + согласование
          </div>
        </div>`
    }

    // ── Area Chart ─────────────────────────────────────────────────────────────
    const chartCtx = el('chart-overview-area')
    if (chartCtx) {
      makeChart(chartCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: d.labels,
          datasets: [
            {
              label: 'Выручка',
              data: d.revenue,
              borderColor: '#10B981',
              backgroundColor: hexToRgba('#10B981', 0.12),
              fill: true,
              tension: 0.4,
              pointRadius: 3
            },
            {
              label: 'Себестоимость',
              data: d.opExpense,
              borderColor: '#EF4444',
              backgroundColor: hexToRgba('#EF4444', 0.08),
              fill: true,
              tension: 0.4,
              pointRadius: 3
            },
            {
              label: 'Вывод',
              data: d.withdrawal,
              borderColor: '#9CA3AF',
              borderDash: [5, 3],
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.4,
              pointRadius: 2
            },
            {
              label: 'Кумулятив',
              data: d.cumulative,
              borderColor: '#6B7280',
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.4,
              borderWidth: 2,
              pointRadius: 3,
              yAxisID: 'y2'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.raw)}`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: false,
              ticks: { callback: v => fmtCompact(v), font: { size: 11 } },
              grid: { color: 'rgba(0,0,0,0.04)' }
            },
            y2: {
              position: 'right',
              min: Math.min(0, ...d.cumulative) * 1.3,
              max: Math.max(0, ...d.cumulative) * 1.3 || 1,
              ticks: { callback: v => fmtCompact(v), font: { size: 11 } },
              grid: { display: false }
            },
            x: { ticks: { font: { size: 11 } } }
          }
        }
      })
    }

    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'
  }

  // ─── FINANCE 2025 ─────────────────────────────────────────────────────────
  function renderFinance2025 () {
    const loading = el('f2025-loading')
    const content = el('f2025-content')
    if (!content) return

    const FD = global.FinanceData
    if (!FD) return
    const f = fmt()
    const dRaw = FD.FACT_2025_MONTHLY
    const T = FD.TOTALS_2025
    const BLOCK_KEYS = FD.BLOCK_KEYS
    const BLOCK_META = FD.BLOCK_META

    // ── Period aggregation ────────────────────────────────────────────────────
    const periodSel = document.getElementById('sel-period')
    const period = periodSel ? periodSel.value : 'year'

    // Агрегирует массив 12 значений по периоду
    function aggregateByPeriod(arr12, periodType) {
      if (periodType === 'year' || periodType === 'custom') return arr12
      if (periodType === 'quarter') {
        return [0,1,2,3].map(q => arr12.slice(q * 3, q * 3 + 3).reduce((s,v) => s + v, 0))
      }
      if (periodType === 'month') {
        // Текущий месяц (0-based)
        const curMonth = new Date().getMonth()
        return [arr12[curMonth] || 0]
      }
      return arr12
    }
    function periodLabels(periodType) {
      if (periodType === 'quarter') return ['Q1', 'Q2', 'Q3', 'Q4']
      if (periodType === 'month') {
        return [FD.MONTHS_SHORT[new Date().getMonth()]]
      }
      return FD.MONTHS_SHORT
    }

    const d = {
      labels: periodLabels(period),
      revenue: aggregateByPeriod(dRaw.revenue, period),
      opExpense: aggregateByPeriod(dRaw.opExpense, period),
      withdrawal: aggregateByPeriod(dRaw.withdrawal, period),
      cumulative: aggregateByPeriod(dRaw.cumulative, period)
    }

    destroyCostCharts()

    // ── KPI cards ─────────────────────────────────────────────────────────────
    const kpisEl = el('f2025-kpis')
    if (kpisEl) {
      const profitColor = T.grossProfit >= 0 ? 'green' : 'red'
      kpisEl.innerHTML =
        kpiCard('Выручка',         fmtCompact(T.revenue),     '💰', 'purple') +
        kpiCard('COGS',            fmtCompact(T.totalCogs),   '📦', 'orange') +
        kpiCard('Валовая прибыль', fmtCompact(T.grossProfit), '📈', profitColor) +
        kpiCard('Вывод средств',   fmtCompact(T.withdrawals), '👤', 'blue') +
        kpiCard('Маржа',           f.pct(T.margin * 100),     '🎯', T.margin >= 0.1 ? 'green' : 'red')
    }

    // ── Alert ─────────────────────────────────────────────────────────────────
    const alertEl = el('f2025-alert')
    if (alertEl) {
      alertEl.innerHTML = `
        <div class="fin-info-box">
          📊 Данные за 2025 год. Выручка: ${fmtCompact(T.revenue)} · COGS: ${fmtCompact(T.totalCogs)} ·
          Маржа: ${f.pct(T.margin * 100)} · Кассовый разрыв: ${fmtCompact(T.yearEndDeficit)}
        </div>`
    }

    // ── Plan vs Fact monthly table ────────────────────────────────────────────
    const pvfEl = el('f2025-plan-vs-fact')
    if (pvfEl) {
      const SE = global.ScenarioEngine
      const LABELS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

      const sumArr = arr => arr.reduce((s, v) => s + v, 0)

      const monthCols = LABELS.map((l, i) => `<th class="num" style="font-size:11px;min-width:70px">${l}</th>`).join('')

      const dataRow = (label, arr, style) => {
        const total = sumArr(arr)
        return `<tr${style ? ` style="${style}"` : ''}>
          <td style="white-space:nowrap;font-size:12px">${label}</td>
          ${arr.map(v => `<td class="num" style="font-size:12px">${fmtCompact(v)}</td>`).join('')}
          <td class="num" style="font-weight:600;font-size:12px">${fmtCompact(total)}</td>
        </tr>`
      }

      // Прибыль помесячная (всегда 12 месяцев из raw данных)
      const factProfit = dRaw.revenue.map((r, i) => r - dRaw.opExpense[i])
      const factMargin = dRaw.revenue.map((r, i) => r > 0 ? ((r - dRaw.opExpense[i]) / r * 100).toFixed(1) + '%' : '—')

      pvfEl.innerHTML = `
        <table class="data-table" style="font-size:12px">
          <thead>
            <tr>
              <th style="min-width:120px">Показатель</th>
              ${monthCols}
              <th class="num" style="font-weight:700;min-width:80px">ИТОГО</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:#F0FDF4"><td colspan="${LABELS.length + 2}" style="font-weight:700;font-size:13px;color:#10B981">ВЫРУЧКА</td></tr>
            ${dataRow('Факт', dRaw.revenue, 'font-weight:600')}

            <tr style="background:#FEF2F2"><td colspan="${LABELS.length + 2}" style="font-weight:700;font-size:13px;color:#EF4444">РАСХОДЫ (COGS)</td></tr>
            ${dataRow('Факт', dRaw.opExpense, 'font-weight:600')}

            <tr style="background:#F5F3FF"><td colspan="${LABELS.length + 2}" style="font-weight:700;font-size:13px;color:#6366F1">ПРИБЫЛЬ</td></tr>
            ${dataRow('Факт', factProfit, 'font-weight:600')}

            <tr style="background:#FFF7ED"><td colspan="${LABELS.length + 2}" style="font-weight:700;font-size:13px;color:#D97706">ВЫВОД СРЕДСТВ</td></tr>
            ${dataRow('Факт', dRaw.withdrawal, 'font-weight:600')}

            <tr>
              <td style="font-weight:600;font-size:12px">Маржа %</td>
              ${factMargin.map(m => `<td class="num" style="font-size:12px;color:${parseFloat(m) >= 10 ? '#10B981' : parseFloat(m) >= 0 ? '#D97706' : '#EF4444'}">${m}</td>`).join('')}
              <td class="num" style="font-weight:600;font-size:12px;color:${T.margin >= 0.1 ? '#10B981' : '#EF4444'}">${f.pct(T.margin * 100)}</td>
            </tr>
          </tbody>
        </table>`
    }

    // ── Area chart ────────────────────────────────────────────────────────────
    const areaCtx = el('chart-f2025-area')
    if (areaCtx) {
      makeChart(areaCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: d.labels,
          datasets: [
            { label: 'Выручка',      data: d.revenue,     borderColor: '#10B981', backgroundColor: hexToRgba('#10B981', 0.1), fill: true, tension: 0.4, pointRadius: 3 },
            { label: 'Себестоимость',data: d.opExpense,   borderColor: '#EF4444', backgroundColor: hexToRgba('#EF4444', 0.07), fill: true, tension: 0.4, pointRadius: 3 },
            { label: 'Прибыль',      data: d.revenue.map((r, i) => r - d.opExpense[i]), borderColor: '#8B5CF6', backgroundColor: hexToRgba('#8B5CF6', 0.08), fill: true, tension: 0.4, pointRadius: 3 },
            { label: 'Вывод',        data: d.withdrawal,  borderColor: '#9CA3AF', borderDash: [4,3], backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2 },
            { label: 'Кум. остаток', data: d.cumulative,  borderColor: '#6366F1', backgroundColor: 'transparent', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 3, yAxisID: 'y2' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.raw)}` } }
          },
          scales: {
            y:  { ticks: { callback: v => fmtCompact(v), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
            y2: {
              position: 'right',
              min: Math.min(0, ...d.cumulative) * 1.3,
              max: Math.max(0, ...d.cumulative) * 1.3 || 1,
              ticks: { callback: v => fmtCompact(v), font: { size: 11 } },
              grid: { display: false }
            },
            x:  { ticks: { font: { size: 11 } } }
          }
        }
      })
    }

    // ── Tree Table ────────────────────────────────────────────────────────────
    const treeEl = el('f2025-tree-table')
    if (treeEl) {
      const dds = global.DashboardData && global.DashboardData.dds
      const tree = FD.getCostTree(dds, 2025)
      const monthlyByBlock = FD.getMonthlyByBlock(dds, 2025)
      _renderTreeTable(treeEl, tree, T.totalCogs, f, monthlyByBlock)
    }

    // ── Waterfall ─────────────────────────────────────────────────────────────
    const wfCtx = el('chart-f2025-waterfall')
    if (wfCtx) {
      const blockTotals = FD.getCostBlockTotals(global.DashboardData && global.DashboardData.dds, 2025)
      const wfLabels = ['Выручка', 'Произв-во', 'Логистика', 'Маркетинг', 'Продажи', 'Налоги', 'Операц.', 'Прибыль', 'Вывод', 'Остаток']
      const blocks = [blockTotals.production, blockTotals.logistics, blockTotals.marketing, blockTotals.sales, blockTotals.taxes, blockTotals.overhead]
      let running = T.revenue
      const starts = [0]
      const heights = [T.revenue]
      const colors  = ['#10B981']
      blocks.forEach(b => {
        starts.push(running - b)
        heights.push(b)
        colors.push('#EF4444')
        running -= b
      })
      starts.push(0); heights.push(T.grossProfit); colors.push('#10B981')
      starts.push(T.grossProfit - T.withdrawals); heights.push(T.withdrawals); colors.push('#9CA3AF')
      starts.push(0); heights.push(T.grossProfit - T.withdrawals); colors.push(T.grossProfit - T.withdrawals >= 0 ? '#10B981' : '#EF4444')

      makeChart(wfCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: wfLabels,
          datasets: [{
            label: 'Сумма',
            data: heights.map((h, i) => [starts[i], starts[i] + h]),
            backgroundColor: colors,
            borderRadius: 3,
            borderWidth: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmtCompact(Math.abs(ctx.raw[1] - ctx.raw[0])) } } },
          scales: {
            y: { ticks: { callback: v => fmtCompact(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
            x: { ticks: { font: { size: 10 } } }
          }
        }
      })
    }

    // ── Heatmap ───────────────────────────────────────────────────────────────
    const hmEl = el('f2025-heatmap')
    if (hmEl) {
      const byBlock = FD.getMonthlyByBlock(global.DashboardData && global.DashboardData.dds, 2025)
      _renderHeatmap(hmEl, byBlock, BLOCK_KEYS, BLOCK_META, d.labels)
    }

    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'
  }

  // ─── FINANCE 2026 ─────────────────────────────────────────────────────────
  // Хранит какие блоки раскрыты (persist через ре-рендеры)
  var _expandedBlocks = {}

  function renderFinance2026 () {
    const loading = el('f2026-loading')
    const content = el('f2026-content')
    if (!content) return

    const FD = global.FinanceData
    const SE = global.ScenarioEngine
    if (!FD || !SE) { console.error('renderFinance2026: FD or SE missing', !!FD, !!SE); return }

    try { _renderFinance2026Inner(FD, SE, loading, content) } catch (e) {
      console.error('renderFinance2026 error:', e)
      if (loading) loading.textContent = 'Ошибка: ' + e.message
    }
  }

  function _renderFinance2026Inner (FD, SE, loading, content) {
    const f = fmt()
    const T = FD.TOTALS_2025
    const BLOCK_KEYS = FD.BLOCK_KEYS
    const BLOCK_META = FD.BLOCK_META
    const state = SE.getState()

    destroyCostCharts()

    // ── Parameters Panel ──────────────────────────────────────────────────────
    const paramsEl = el('f2026-params')
    const qCoef = state.quarterCoef || [1, 1, 1, 1]
    const factMonthlyRev = FD.FACT_2025_MONTHLY.revenue
    // Формула: Факт_месяц × (1 + рост%) × Q_множитель × (1 + инфляция%)
    const planRevMonthlyQ = SE.computeMonthlyRevenueQ(factMonthlyRev, state.revenueGrowthPct, qCoef, state.inflationPct || 0)
    const planRevenueTotal = planRevMonthlyQ.reduce((s, v) => s + v, 0)
    const avgGrowthPct = state.revenueGrowthPct

    if (paramsEl) {
      const qLabels = ['Q1', 'Q2', 'Q3', 'Q4']
      paramsEl.innerHTML = `
        <div class="card" style="grid-column:1/-1;margin-bottom:0">
          <div class="fin-params-grid">
            <div class="fin-params-item">
              <div class="fin-params-label">Рост оборота %</div>
              <div class="fin-params-control">
                <input type="range" class="fin-slider" id="f2026-growth-slider" min="0" max="100" value="${state.revenueGrowthPct}">
                <input type="number" id="f2026-growth-num" value="${state.revenueGrowthPct}" min="0" max="100" style="width:52px;padding:4px 6px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:center">
              </div>
              <div class="fin-params-calc" id="f2026-growth-calc">→ ${fmtCompact(planRevenueTotal)} план</div>
            </div>
            <div class="fin-params-item">
              <div class="fin-params-label">Квартальные множители</div>
              <div style="display:flex;gap:8px;margin-top:4px">
                ${qLabels.map((ql, qi) => `<label style="display:flex;flex-direction:column;align-items:center;gap:2px">
                  <span style="font:500 11px/1 var(--font);color:var(--text-muted)">${ql}</span>
                  <input type="number" id="f2026-qcoef-${qi}" value="${qCoef[qi]}" min="0.1" max="3" step="0.05"
                    style="width:52px;padding:4px 6px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:center">
                </label>`).join('')}
              </div>
            </div>
            <div class="fin-params-item">
              <div class="fin-params-label">Лимит вывода/мес</div>
              <div class="fin-params-control">
                <input type="number" id="f2026-withdrawal" value="${state.withdrawalLimit}" step="50000" style="width:110px;padding:4px 8px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:right">
              </div>
              <div class="fin-params-calc">→ ${fmtCompact(state.withdrawalLimit * 12)} /год</div>
            </div>
            <div class="fin-params-item">
              <div class="fin-params-label">Инфляция %</div>
              <div class="fin-params-control">
                <input type="number" id="f2026-inflation" value="${state.inflationPct || 0}" min="0" max="30" style="width:60px;padding:4px 8px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:center">
                <span style="font-size:12px;color:var(--text-muted)">%</span>
              </div>
              <div class="fin-params-calc">ср. по РК</div>
            </div>
            <div class="fin-params-item">
              <div class="fin-params-label">Цел. маржинальность %</div>
              <div class="fin-params-control">
                <input type="number" id="f2026-margin" value="${state.targetMarginPct}" min="0" max="80" style="width:60px;padding:4px 8px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:center">
                <span style="font-size:12px;color:var(--text-muted)">%</span>
              </div>
              ${(() => {
                if (!state.targetMarginPct) return ''
                const growthMul = 1 + (state.revenueGrowthPct || 0) / 100
                const factCogs = BLOCK_KEYS.reduce((s, k) => s + BLOCK_META[k].factTotal, 0)
                const planRev = FD.FACT_2025_MONTHLY.revenue.reduce((s, v, i) => {
                  return s + Math.round(v * growthMul * ((qCoef[Math.floor(i/3)] || 1)))
                }, 0)
                const neededCogs = planRev * (1 - state.targetMarginPct / 100)
                const planCogsBeforeOpt = factCogs * growthMul
                const reqOpt = Math.round((1 - neededCogs / planCogsBeforeOpt) * 100)
                const color = reqOpt <= 0 ? '#10B981' : reqOpt <= 20 ? '#6366F1' : '#DC2626'
                return `<div class="fin-params-calc" style="font-size:10px;color:${color}">→ оптимизация COGS ${reqOpt}%</div>`
              })()}
            </div>
            <div class="fin-params-item">
              <div class="fin-params-label">Кассовый разрыв</div>
              <div class="fin-params-control">
                <input type="number" id="f2026-cashgap" value="${state.cashGapDebt || 5431123}" step="100000" style="width:120px;padding:4px 8px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:13px;text-align:right;color:#9A3412">
                <span style="font-size:12px;color:var(--text-muted)">₸</span>
              </div>
              <div class="fin-params-calc" style="font-size:10px;color:var(--text-muted)">погашается из прибыли</div>
            </div>
          </div>
        </div>`

      // Bind events
      setTimeout(() => {
        const slider = el('f2026-growth-slider')
        const numInput = el('f2026-growth-num')
        const calcEl = el('f2026-growth-calc')
        const syncGrowth = val => {
          val = Math.max(0, Math.min(100, Number(val) || 0))
          if (slider) slider.value = val
          if (numInput) numInput.value = val
          SE.setState({ revenueGrowthPct: val })
          renderFinance2026()
        }
        if (slider) slider.addEventListener('input', e => syncGrowth(e.target.value))
        if (numInput) numInput.addEventListener('change', e => syncGrowth(e.target.value))

        // Quarter coefficient inputs
        for (let qi = 0; qi < 4; qi++) {
          const inp = el('f2026-qcoef-' + qi)
          if (inp) inp.addEventListener('change', () => {
            const newCoef = [0, 1, 2, 3].map(i => {
              const v = parseFloat(el('f2026-qcoef-' + i)?.value)
              return isNaN(v) ? 1 : Math.max(0.1, Math.min(3, v))
            })
            SE.setState({ quarterCoef: newCoef })
            renderFinance2026()
          })
        }

        const withdrawalInp = el('f2026-withdrawal')
        if (withdrawalInp) withdrawalInp.addEventListener('change', e => {
          SE.setState({ withdrawalLimit: Math.max(0, Number(e.target.value) || 0) })
          renderFinance2026()
        })

        const inflationInp = el('f2026-inflation')
        if (inflationInp) inflationInp.addEventListener('change', e => {
          SE.setState({ inflationPct: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })
          renderFinance2026()
        })

        const marginInp = el('f2026-margin')
        if (marginInp) marginInp.addEventListener('change', e => {
          const targetMargin = Math.max(0, Math.min(80, Number(e.target.value) || 0))
          SE.setState({ targetMarginPct: targetMargin })
          if (targetMargin > 0) {
            // Маржа зависит не от роста (оба растут пропорционально), а от оптимизации COGS.
            // Формула: margin = (planRev - planCogs) / planRev
            // planRev = factRev × growthMul   (выручка с учётом роста)
            // planCogs = factCogs × growthMul × (1 - opt)
            // Подставляем: margin = 1 - factCogs×(1-opt) / factRev
            // => opt = 1 - factRev×(1-margin) / factCogs
            const curState = SE.getState()
            const growthMul = 1 + (curState.revenueGrowthPct || 0) / 100
            const factCogs = FD.BLOCK_KEYS.reduce((s, k) => s + FD.BLOCK_META[k].factTotal, 0)
            const planRev = FD.FACT_2025_MONTHLY.revenue.reduce((s, v, i) => {
              const q = Math.floor(i / 3)
              return s + Math.round(v * growthMul * ((curState.quarterCoef || [1,1,1,1])[q] || 1))
            }, 0)
            const neededCogs = planRev * (1 - targetMargin / 100)
            const planCogsBeforeOpt = factCogs * growthMul
            const requiredOpt = Math.round((1 - neededCogs / planCogsBeforeOpt) * 100)
            // Применяем нужный % оптимизации ко всем блокам
            if (requiredOpt >= 0 && requiredOpt <= 80) {
              const newOpt = {}
              FD.BLOCK_KEYS.forEach(k => { newOpt[k] = requiredOpt })
              SE.setState({ costOpt: newOpt })
            }
          }
          renderFinance2026()
        })

        const cashGapInp = el('f2026-cashgap')
        if (cashGapInp) cashGapInp.addEventListener('change', e => {
          SE.setState({ cashGapDebt: Math.max(0, Number(e.target.value) || 0) })
          renderFinance2026()
        })

      }, 50)
    }

    // ── Plan/Fact Table ───────────────────────────────────────────────────────
    const planTableEl = el('f2026-plan-table')
    if (planTableEl) {
      const factBlocks = FD.getCostBlockTotals(global.DashboardData && global.DashboardData.dds, 2025)
      const costOptPct = state.costOpt || {}
      const q1 = FD.getQ1Fact(global.DashboardData && global.DashboardData.dds, 2026)
      // Сумма факт расходов
      const totalFactCogs = BLOCK_KEYS.reduce((s, k) => s + factBlocks[k], 0)
      // Формула плана: Факт × (1 + рост%) × (1 - оптимизация%)
      // Без эластичности и отдельного инфляционного множителя — рост уже учитывает инфляцию
      const growthMulCost = 1 + avgGrowthPct / 100
      const costTree = FD.getCostTree(global.DashboardData && global.DashboardData.dds, 2025)

      // Считаем totalPlanCogs до рендера — нужна в нескольких местах шаблона
      const totalPlanCogs = BLOCK_KEYS.reduce((s, k) => {
        const o2 = costOptPct[k] || 0
        return s + Math.round(factBlocks[k] * growthMulCost * (1 - o2 / 100))
      }, 0)

      const table = document.createElement('table')
      table.className = 'data-table'
      table.innerHTML = `
        <thead>
          <tr>
            <th>Блок</th>
            <th class="num">Факт 2025</th>
            <th class="num">% от COGS</th>
            <th class="num">Оптимизация</th>
            <th class="num">План 2026</th>
            <th class="num">% плана</th>
            <th class="num">Δ к факту</th>
          </tr>
        </thead>
        <tbody>
          ${(() => {
            // ── Оборот (Доходы) ──
            const INC = FD.INCOME_2025_MONTHLY
            const incFact = INC.total.reduce((s, v) => s + v, 0)
            // План оборота: Факт × (1+рост%) × Q_множитель
            const growthMul = 1 + (state.revenueGrowthPct || 0) / 100
            const incPlanServices = planRevenueTotal  // услуги = уже рассчитаны
            const incPlanFinOps = INC.finOps.reduce((s, v, i) => {
              const q = Math.floor(i / 3)
              return s + Math.round(v * growthMul * (qCoef[q] || 1))
            }, 0)
            const incPlanTopUp = INC.topUp.reduce((s, v, i) => {
              const q = Math.floor(i / 3)
              return s + Math.round(v * growthMul * (qCoef[q] || 1))
            }, 0)
            const incPlanTotal = incPlanServices + incPlanFinOps + incPlanTopUp
            const incDelta = incFact > 0 ? (incPlanTotal - incFact) / incFact * 100 : 0
            const incDeltaSign = incDelta >= 0 ? '+' : ''
            const incDeltaCls = incDelta >= 0 ? 'color:#2E865F;background:#C6F4D6' : 'color:#DC2626;background:#FEE2E2'

            const incChildren = [
              { label: 'Услуги', fact: INC.services.reduce((s, v) => s + v, 0), plan: incPlanServices },
              { label: 'Финансовые операции', fact: INC.finOps.reduce((s, v) => s + v, 0), plan: incPlanFinOps },
              { label: 'Пополнение', fact: INC.topUp.reduce((s, v) => s + v, 0), plan: incPlanTopUp }
            ].filter(ch => ch.fact > 0 || ch.plan > 0)

            const _incExp = _expandedBlocks['income']
            const incChildRows = incChildren.map(ch => {
              const chDelta = ch.fact > 0 ? (ch.plan - ch.fact) / ch.fact * 100 : 0
              return `<tr class="plan-detail plan-detail-income" style="display:${_incExp ? '' : 'none'};background:#F0FDF4">
                <td style="padding-left:28px;font-size:11px;color:var(--text-secondary)">▸ ${ch.label}</td>
                <td class="num" style="font-size:11px;color:var(--text-muted)">${fmtCompact(ch.fact)}</td>
                <td class="num" style="font-size:11px;color:var(--text-muted)">—</td>
                <td class="num"></td>
                <td class="num" style="font-size:11px">${fmtCompact(ch.plan)}</td>
                <td class="num" style="font-size:11px">—</td>
                <td class="num"><span style="padding:2px 7px;border-radius:20px;font-size:11px;${ch.fact > 0 ? (chDelta >= 0 ? 'color:#2E865F;background:#C6F4D6' : 'color:#DC2626;background:#FEE2E2') : ''}">${ch.fact > 0 ? (chDelta >= 0 ? '+' : '') + chDelta.toFixed(1) + '%' : '—'}</span></td>
              </tr>`
            }).join('')

            const incomeRows = `<tr class="plan-block-row" data-toggle-block="income" style="cursor:pointer;background:#F0FDF4;font-weight:600">
              <td><span class="cost-dot" style="background:#10B981"></span>${_incExp ? '▼' : '▶'} Оборот (Доходы)</td>
              <td class="num">${fmtCompact(incFact)}</td>
              <td class="num">—</td>
              <td class="num">+${avgGrowthPct}%</td>
              <td class="num" style="color:#10B981">${fmtCompact(incPlanTotal)}</td>
              <td class="num">—</td>
              <td class="num"><span style="padding:2px 7px;border-radius:20px;font-size:12px;${incDeltaCls}">${incDeltaSign}${incDelta.toFixed(1)}%</span></td>
            </tr>${incChildRows}`

            return incomeRows + BLOCK_KEYS.map(k => {
              const meta = BLOCK_META[k]
              const fact = factBlocks[k]
              const opt = costOptPct[k] || 0
              const plan = Math.round(fact * growthMulCost * (1 - opt / 100))
              const planPct = totalPlanCogs > 0 ? (plan / totalPlanCogs * 100).toFixed(1) : '0.0'
              const delta = (plan - fact) / fact * 100
              const deltaSign = delta >= 0 ? '+' : ''
              const deltaCls = delta <= 0 ? 'color:#2E865F;background:#C6F4D6' : delta <= 15 ? 'color:#D97706;background:#FEF3C7' : 'color:#DC2626;background:#FEE2E2'

              // Подкатегории для drill-down
              const treeBlock = costTree && costTree.find(b => b.id === k)
              const children = treeBlock && treeBlock.children ? treeBlock.children : []
              const scaleFactor = growthMulCost * (1 - opt / 100)

              const _blkExp = _expandedBlocks[k]
              let childRows = ''
              if (children.length > 0) {
                childRows = children.map(ch => {
                  const chPlan = Math.round(ch.total * scaleFactor)
                  const chPct = totalPlanCogs > 0 ? (chPlan / totalPlanCogs * 100).toFixed(1) : '0.0'
                  return `<tr class="plan-detail plan-detail-${k}" style="display:${_blkExp ? '' : 'none'};background:#FAFAFA">
                    <td style="padding-left:28px;font-size:11px;color:var(--text-secondary)">▸ ${ch.label}</td>
                    <td class="num" style="font-size:11px;color:var(--text-muted)">${fmtCompact(ch.total)}</td>
                    <td class="num" style="font-size:11px;color:var(--text-muted)">${(ch.total / totalFactCogs * 100).toFixed(1)}%</td>
                    <td class="num"></td>
                    <td class="num" style="font-size:11px">${fmtCompact(chPlan)}</td>
                    <td class="num" style="font-size:11px">${chPct}%</td>
                    <td class="num"></td>
                  </tr>`
                }).join('')
              }

              return `<tr class="plan-block-row" data-toggle-block="${k}" style="cursor:pointer">
                <td><span class="cost-dot" style="background:${meta.color}"></span>${children.length > 0 ? (_blkExp ? '▼ ' : '▶ ') : ''}${meta.label}</td>
                <td class="num">${fmtCompact(fact)}</td>
                <td class="num">${f.pct(meta.sharePct)}</td>
                <td class="num">
                  <input type="number" value="${opt}" min="0" max="50" data-block="${k}"
                    style="width:52px;padding:3px 6px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;font-size:12px;text-align:center">%
                </td>
                <td class="num">${fmtCompact(plan)}</td>
                <td class="num">${planPct}%</td>
                <td class="num"><span style="padding:2px 7px;border-radius:20px;font-size:12px;${deltaCls}">${deltaSign}${delta.toFixed(1)}%</span></td>
              </tr>${childRows}`
            }).join('')
          })()}
          <tr style="font-weight:700;border-top:2px solid rgba(0,0,0,.08);background:#F9FAFB">
            <td>ИТОГО COGS</td>
            <td class="num">${fmtCompact(totalFactCogs)}</td>
            <td class="num">100%</td>
            <td class="num">—</td>
            <td class="num">${fmtCompact(totalPlanCogs)}</td>
            <td class="num">100%</td>
            <td class="num">—</td>
          </tr>
          ${(() => {
            const _gMul = 1 + (state.revenueGrowthPct || 0) / 100
            const _incPlanTotal2 = planRevenueTotal + FD.INCOME_2025_MONTHLY.finOps.reduce((s, v, i) => s + Math.round(v * _gMul * (qCoef[Math.floor(i/3)] || 1)), 0) + FD.INCOME_2025_MONTHLY.topUp.reduce((s, v, i) => s + Math.round(v * _gMul * (qCoef[Math.floor(i/3)] || 1)), 0)
            const grossProfit = _incPlanTotal2 - totalPlanCogs
            const factGross = T.totalIncome - totalFactCogs
            const gpDelta = factGross !== 0 ? (grossProfit - factGross) / Math.abs(factGross) * 100 : 0
            return `<tr style="background:#F5F3FF;font-weight:700">
              <td>Валовая прибыль</td>
              <td class="num">${fmtCompact(factGross)}</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num" style="color:${grossProfit >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(grossProfit)}</td>
              <td class="num">—</td>
              <td class="num"><span style="padding:2px 7px;border-radius:20px;font-size:12px;${grossProfit >= factGross ? 'color:#2E865F;background:#C6F4D6' : 'color:#DC2626;background:#FEE2E2'}">${gpDelta >= 0 ? '+' : ''}${gpDelta.toFixed(1)}%</span></td>
            </tr>`
          })()}
        </tbody>`

      planTableEl.innerHTML = ''
      planTableEl.appendChild(table)

      // Bind cost-opt inputs + drill-down toggle
      setTimeout(() => {
        // Toggle drill-down rows
        planTableEl.querySelectorAll('[data-toggle-block]').forEach(row => {
          row.addEventListener('click', e => {
            if (e.target.tagName === 'INPUT') return  // не toggle при клике на input
            const blockKey = row.dataset.toggleBlock
            const details = planTableEl.querySelectorAll('.plan-detail-' + blockKey)
            const isHidden = details.length > 0 && details[0].style.display === 'none'
            details.forEach(d => { d.style.display = isHidden ? '' : 'none' })
            // Сохраняем состояние раскрытия
            _expandedBlocks[blockKey] = isHidden
            // Меняем стрелку
            const td = row.querySelector('td')
            if (td) td.innerHTML = td.innerHTML.replace(isHidden ? '▶' : '▼', isHidden ? '▼' : '▶')
          })
        })
        planTableEl.querySelectorAll('input[data-block]').forEach(inp => {
          inp.addEventListener('change', e => {
            const k = e.target.dataset.block
            const newOpt = Object.assign({}, state.costOpt, { [k]: Math.max(0, Number(e.target.value) || 0) })
            SE.setState({ costOpt: newOpt })
            renderFinance2026()
          })
        })
      }, 50)
    }

    // ── Monthly Plan Table 2026 ──────────────────────────────────────────────
    const monthlyPlanEl = el('f2026-monthly-plan')
    if (monthlyPlanEl) {
      const factBlocks2 = FD.getCostBlockTotals(global.DashboardData && global.DashboardData.dds, 2025)
      const costOptPct2 = state.costOpt || {}
      const costResult = SE.computeMonthlyCosts(factBlocks2, costOptPct2, avgGrowthPct, state.inflationPct || 0)
      const planRevMonthly = planRevMonthlyQ
      const LABELS = FD.MONTHS_SHORT
      const sumArr = arr => arr.reduce((s, v) => s + v, 0)

      const qNames = ['Q1', 'Q2', 'Q3', 'Q4']
      const qSum = (arr, q) => arr[q*3] + arr[q*3+1] + arr[q*3+2]

      // Заголовки: Янв Фев Мар Q1 | Апр Май Июн Q2 | ...
      const monthCols = [0,1,2,3].map(q =>
        [0,1,2].map(m => `<th class="num" style="font-size:11px;min-width:64px">${LABELS[q*3+m]}</th>`).join('') +
        `<th class="num" style="font-size:11px;min-width:64px;background:#F3F4F6;font-weight:700">${qNames[q]}</th>`
      ).join('')

      const dataRow2 = (label, arr, style, cellStyle) => {
        const cs = cellStyle || ''
        return `<tr${style ? ` style="${style}"` : ''}>
          <td style="white-space:nowrap;font-size:12px">${label}</td>
          ${[0,1,2,3].map(q =>
            [0,1,2].map(m => `<td class="num" style="font-size:12px;${cs}">${fmtCompact(arr[q*3+m])}</td>`).join('') +
            `<td class="num" style="font-size:12px;font-weight:600;background:#F9FAFB;${cs}">${fmtCompact(qSum(arr, q))}</td>`
          ).join('')}
          <td class="num" style="font-weight:700;font-size:12px;${cs}">${fmtCompact(sumArr(arr))}</td>
        </tr>`
      }

      const withdrawalPerMonth = state.withdrawalLimit || 0
      const profitMonthly = planRevMonthly.map((r, i) => r - costResult.byMonth[i] - withdrawalPerMonth)

      // Кассовый разрыв — погашение из прибыли
      // Прибыль > 0 → уменьшаем долг, Прибыль < 0 → долг растёт
      const gapDebt = state.cashGapDebt || 5_431_123
      const gapMonthly = new Array(12).fill(0)
      let gapRemaining = gapDebt
      const gapBalance = new Array(12).fill(0)
      for (let i = 0; i < 12; i++) {
        const profit = profitMonthly[i]
        if (profit > 0 && gapRemaining > 0) {
          // Прибыль есть — погашаем долг (не больше остатка)
          const pay = Math.min(profit, gapRemaining)
          gapMonthly[i] = pay
          gapRemaining -= pay
        } else if (profit < 0) {
          // Убыток — кассовый разрыв увеличивается
          gapMonthly[i] = profit // отрицательное значение = рост долга
          gapRemaining -= profit // -= отрицательное = увеличение
        }
        gapBalance[i] = gapRemaining
      }
      const gapClosureMonth = gapBalance.findIndex(v => v <= 0)

      monthlyPlanEl.innerHTML = `
        <table class="data-table" style="font-size:12px">
          <thead>
            <tr>
              <th style="min-width:120px">Статья</th>
              ${monthCols}
              <th class="num" style="font-weight:700;min-width:72px">ИТОГО</th>
            </tr>
          </thead>
          <tbody>
            ${BLOCK_KEYS.map(k => {
              const meta = BLOCK_META[k]
              const blockTotal = sumArr(costResult.byBlock[k])
              const totalCogs = sumArr(costResult.byMonth)
              const pct = totalCogs > 0 ? (blockTotal / totalCogs * 100).toFixed(1) : '0.0'
              return dataRow2(
                `<span class="cost-dot" style="background:${meta.color}"></span>${meta.label} <span style="font-size:10px;color:var(--text-muted)">(${pct}%)</span>`,
                costResult.byBlock[k],
                ''
              )
            }).join('')}
            ${dataRow2('ИТОГО расходы', costResult.byMonth, 'font-weight:700;border-top:2px solid rgba(0,0,0,.08);background:#FEF2F2')}
            ${dataRow2('Выручка план', planRevMonthly, 'font-weight:700;background:#F0FDF4', 'color:#10B981')}
            ${withdrawalPerMonth > 0 ? dataRow2('Вывод собственника', new Array(12).fill(-withdrawalPerMonth), 'background:#F9FAFB', 'color:#6B7280') : ''}
            ${(() => {
              const profitCells = [0,1,2,3].map(q =>
                [0,1,2].map(m => {
                  const v = profitMonthly[q*3+m]
                  return `<td class="num" style="font-size:12px;color:${v >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(v)}</td>`
                }).join('') +
                `<td class="num" style="font-size:12px;font-weight:600;background:#F9FAFB;color:${qSum(profitMonthly, q) >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(qSum(profitMonthly, q))}</td>`
              ).join('')
              return `<tr style="font-weight:700;background:#F5F3FF">
                <td style="font-size:12px">Прибыль план</td>
                ${profitCells}
                <td class="num" style="font-size:12px;color:${sumArr(profitMonthly) >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(sumArr(profitMonthly))}</td>
              </tr>`
            })()}
            ${(() => {
              const gapCells = [0,1,2,3].map(q =>
                [0,1,2].map(m => {
                  const v = gapMonthly[q*3+m]
                  if (v > 0) return `<td class="num" style="font-size:12px;color:#9A3412">-${fmtCompact(v)}</td>`
                  if (v < 0) return `<td class="num" style="font-size:12px;color:#EF4444">+${fmtCompact(Math.abs(v))}</td>`
                  return `<td class="num" style="font-size:12px;color:var(--text-muted)">—</td>`
                }).join('') +
                `<td class="num" style="font-size:12px;font-weight:600;background:#F9FAFB;color:#9A3412">${fmtCompact(qSum(gapMonthly, q))}</td>`
              ).join('')
              return `<tr style="background:#FFF7ED;border-top:2px solid rgba(0,0,0,.06)">
                <td style="font-size:12px;color:#9A3412">
                  Погашение разрыва
                  <span style="font-size:10px;display:block;color:#C2410C">Долг: ${fmtCompact(gapDebt)}${gapClosureMonth >= 0 ? ' · выход в 0: ' + LABELS[gapClosureMonth] : ''}</span>
                </td>
                ${gapCells}
                <td class="num" style="font-size:12px;color:#9A3412">${fmtCompact(gapDebt - gapRemaining)}</td>
              </tr>`
            })()}
            ${(() => {
              const balCells = [0,1,2,3].map(q =>
                [0,1,2].map(m => {
                  const v = gapBalance[q*3+m]
                  return `<td class="num" style="font-size:12px;color:${v > 0 ? '#DC2626' : '#10B981'}">${v > 0 ? fmtCompact(v) : '✓'}</td>`
                }).join('') +
                `<td class="num" style="font-size:12px;font-weight:600;background:#F9FAFB;color:${gapBalance[q*3+2] > 0 ? '#DC2626' : '#10B981'}">${gapBalance[q*3+2] > 0 ? fmtCompact(gapBalance[q*3+2]) : '✓'}</td>`
              ).join('')
              return `<tr style="background:#FFF7ED">
                <td style="font-size:12px;color:#9A3412">Остаток долга</td>
                ${balCells}
                <td class="num" style="font-size:12px;color:${gapRemaining > 0 ? '#DC2626' : '#10B981'}">${gapRemaining > 0 ? fmtCompact(gapRemaining) : '✓ Закрыт'}</td>
              </tr>`
            })()}
          </tbody>
        </table>`
    }

    // ── Scenario Cards ────────────────────────────────────────────────────────
    const scenEl = el('f2026-scenarios')
    if (scenEl) {
      const LABELS = FD.MONTHS_SHORT
      const scenColors = ['#EF4444', '#6366F1', '#10B981']
      const scenarioCumulatives = []

      // "Базовый" сценарий синхронизируется с текущим ползунком
      const dynScenarios = state.scenarios.map(sc =>
        sc.name === 'Базовый'
          ? Object.assign({}, sc, { revenueGrowth: avgGrowthPct, withdrawalLimit: state.withdrawalLimit })
          : sc
      )

      scenEl.innerHTML = dynScenarios.map((sc, idx) => {
        const res = SE.computeScenario(
          { revenue: T.revenue, totalCogs: T.totalCogs, withdrawals: T.withdrawals },
          { revenueGrowth: sc.revenueGrowth, costOpt: sc.costOpt, withdrawalLimit: sc.withdrawalLimit }
        )
        scenarioCumulatives.push(res.cumulative)
        const closureIdx = SE.computeGapClosure(res.cumulative)
        const finalBalance = res.cumulative[11]
        const planRevenue = fmtCompact(T.revenue * (1 + sc.revenueGrowth / 100))

        return `
          <div class="scenario-card">
            <div class="scenario-card__header">${sc.name}</div>
            <div class="scenario-card__inputs">
              <div class="scenario-card__input-row">
                <span class="scenario-card__input-label">Рост выручки</span>
                <strong>${sc.revenueGrowth}%</strong>
              </div>
              <div class="scenario-card__input-row">
                <span class="scenario-card__input-label">Оптимизация затрат</span>
                <strong>${sc.costOpt}%</strong>
              </div>
              <div class="scenario-card__input-row">
                <span class="scenario-card__input-label">Лимит вывода/мес</span>
                <strong>${fmtCompact(sc.withdrawalLimit)}</strong>
              </div>
            </div>
            <div style="border-top:1px solid #F3F4F6;padding-top:10px">
              <div class="scenario-card__input-row">
                <span class="scenario-card__input-label">Выручка план</span>
                <strong style="color:#10B981">${planRevenue}</strong>
              </div>
              <div class="scenario-card__input-row">
                <span class="scenario-card__input-label">Остаток Dec 2026</span>
                <strong style="color:${finalBalance >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(finalBalance)}</strong>
              </div>
              <div class="scenario-card__input-row">
                <span class="scenario-card__input-label">Выход в 0</span>
                <strong>${closureIdx != null ? LABELS[closureIdx] + ' 2026' : 'Не ожидается'}</strong>
              </div>
            </div>
          </div>`
      }).join('')

      // ── Scenario Chart ───────────────────────────────────────────────────────
      const scenCtx = el('chart-f2026-scenarios')
      if (scenCtx) {
        makeChart(scenCtx.getContext('2d'), {
          type: 'line',
          data: {
            labels: FD.MONTHS_SHORT,
            datasets: dynScenarios.map((sc, i) => ({
              label: sc.name,
              data: scenarioCumulatives[i],
              borderColor: scenColors[i],
              backgroundColor: 'transparent',
              tension: 0.4,
              borderWidth: 2,
              pointRadius: 3
            }))
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
              tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.raw)}` } }
            },
            scales: {
              y: {
                ticks: { callback: v => fmtCompact(v), font: { size: 11 } },
                grid: {
                  color: function (ctx) { return ctx.tick && ctx.tick.value === 0 ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.04)' },
                  lineWidth: function (ctx) { return ctx.tick && ctx.tick.value === 0 ? 2 : 1 }
                }
              },
              x: { ticks: { font: { size: 11 } } }
            }
          }
        })
      }
    }

    // ── Growth 2026-2028 ──────────────────────────────────────────────────────
    const growthTableEl = el('f2026-growth-table')
    if (growthTableEl) {
      const growthData = SE.computeGrowthPlan({ revenue: T.revenue, totalCogs: T.totalCogs })
      growthTableEl.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Показатель</th>
              <th class="num">Факт 2025</th>
              ${growthData.map(g => `<th class="num">${g.year} (+${g.growth}%)</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Выручка</td>
              <td class="num">${fmtCompact(T.revenue)}</td>
              ${growthData.map(g => `<td class="num" style="color:#10B981;font-weight:600">${fmtCompact(g.revenue)}</td>`).join('')}
            </tr>
            <tr>
              <td>COGS</td>
              <td class="num">${fmtCompact(T.totalCogs)}</td>
              ${growthData.map(g => `<td class="num">${fmtCompact(g.cogs)}</td>`).join('')}
            </tr>
            <tr>
              <td>Валовая прибыль</td>
              <td class="num">${fmtCompact(T.grossProfit)}</td>
              ${growthData.map(g => `<td class="num" style="color:${g.profit >= 0 ? '#10B981':'#EF4444'};font-weight:600">${fmtCompact(g.profit)}</td>`).join('')}
            </tr>
            <tr>
              <td>Маржа</td>
              <td class="num">${f.pct(T.margin * 100)}</td>
              ${growthData.map(g => `<td class="num" style="color:${g.margin >= 10 ? '#10B981':'#EF4444'}">${f.pct(g.margin)}</td>`).join('')}
            </tr>
            <tr>
              <td>Заказов/год (оценка)</td>
              <td class="num">~3 200</td>
              ${growthData.map(g => `<td class="num">${f.num(g.orders)}</td>`).join('')}
            </tr>
            <tr>
              <td>Средний чек</td>
              <td class="num">${fmtCompact(24612)}</td>
              ${growthData.map(g => `<td class="num">${fmtCompact(g.avgCheck)}</td>`).join('')}
            </tr>
          </tbody>
        </table>`

      // Growth chart
      const growthCtx = el('chart-f2026-growth')
      if (growthCtx) {
        makeChart(growthCtx.getContext('2d'), {
          type: 'bar',
          data: {
            labels: ['2025 (факт)', ...growthData.map(g => String(g.year))],
            datasets: [
              {
                label: 'Выручка',
                data: [T.revenue, ...growthData.map(g => g.revenue)],
                backgroundColor: '#10B981',
                borderRadius: 4
              },
              {
                label: 'COGS',
                data: [T.totalCogs, ...growthData.map(g => g.cogs)],
                backgroundColor: '#EF4444',
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.raw)}` } } },
            scales: {
              y: { ticks: { callback: v => fmtCompact(v), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
              x: { ticks: { font: { size: 11 } } }
            }
          }
        })
      }
    }

    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'
  }

  // ─── CALENDAR ─────────────────────────────────────────────────────────────
  function renderCalendar () {
    const loading = el('fcal-loading')
    const content = el('fcal-content')
    if (!content) return

    const FD = global.FinanceData
    const SE = global.ScenarioEngine
    const f = fmt()

    // Выбор года
    const selectedYear = Number((el('fcal-year-select') || {}).value) || 2025
    const is2026 = selectedYear === 2026

    // Обновляем заголовок DDS
    const ddsTitle = el('fcal-dds-title')
    if (ddsTitle) ddsTitle.textContent = `ДДС ${selectedYear} — помесячная сводка`

    // Транзакции из DashboardData
    const rawData = global.DashboardData
    const rawTransactions = (rawData && Array.isArray(rawData.transactions)) ? rawData.transactions.filter(t => {
      if (!t.date) return false
      return is2026 ? t.date.startsWith('2026') : t.date.startsWith('2025')
    }) : []

    // Собираем единый массив: приходы (из транзакций) + расходы (из DDS помесячных)
    const allTransactions = []

    // Приходы — из реальных транзакций
    rawTransactions.forEach(t => {
      allTransactions.push({
        date: t.date || '—',
        type: 'income',
        article: t.source || 'Оплата',
        category: 'Приход',
        amount: Math.abs(t.amount || 0),
        comment: t.productId ? t.productId.slice(-6) : '—',
        block: '',
        _raw: t
      })
    })

    // Расходы — из DDS помесячных данных (факт 2025 или план 2026), распределённые по дням
    if (FD) {
      const BLOCK_KEYS = FD.BLOCK_KEYS
      const BLOCK_META = FD.BLOCK_META
      const monthDays = is2026 ? [31,28,31,30,31,30,31,31,30,31,30,31] : [31,28,31,30,31,30,31,31,30,31,30,31]

      let expByBlock

      if (is2026 && SE) {
        // 2026: факт из DDS + план для месяцев без факта
        const factDds2026 = FD.getMonthlyByBlock(rawData && rawData.dds, 2026) || {}
        const state26 = SE.getState()
        const factBlocks25 = FD.getCostBlockTotals(rawData && rawData.dds, 2025)
        const planResult = SE.computeMonthlyCosts(factBlocks25, state26.costOpt || {}, state26.revenueGrowthPct, state26.inflationPct || 0)

        expByBlock = {}
        BLOCK_KEYS.forEach(k => {
          const factArr = factDds2026[k] || new Array(12).fill(0)
          const planArr = planResult.byBlock[k] || new Array(12).fill(0)
          // Если месяц имеет факт > 0 — используем факт, иначе план
          expByBlock[k] = factArr.map((fv, i) => fv > 0 ? fv : planArr[i])
        })
      } else {
        // 2025: реальные данные
        expByBlock = {}
        BLOCK_KEYS.forEach(k => {
          expByBlock[k] = FD.getMonthlyByBlock(rawData && rawData.dds, 2025)[k] || []
        })
      }

      BLOCK_KEYS.forEach(k => {
        const meta = BLOCK_META[k]
        const monthly = expByBlock[k] || []
        monthly.forEach((monthTotal, mi) => {
          if (!monthTotal || monthTotal <= 0) return
          const days = monthDays[mi]
          const dailyAmt = Math.round(monthTotal / days)
          for (let day = 1; day <= days; day++) {
            const mm = String(mi + 1).padStart(2, '0')
            const dd = String(day).padStart(2, '0')
            allTransactions.push({
              date: `${selectedYear}-${mm}-${dd}`,
              type: 'expense',
              article: meta.label,
              category: 'Расход' + (is2026 ? ' (план)' : ''),
              amount: dailyAmt,
              comment: meta.label,
              block: k
            })
          }
        })
      })
    }

    // Даже без транзакций — показываем помесячную сводку ДДС

    destroyCostCharts()

    // ── State for filtering/sorting/pagination ─────────────────────────────────
    let filtered = [...allTransactions]
    let sortKey = 'date', sortDir = 1
    let page = 0
    const PAGE_SIZE = 50

    const filterAndRender = () => {
      const blockFilter   = (el('fcal-filter-block')   || {}).value || ''
      const typeFilter    = (el('fcal-filter-type')    || {}).value || ''
      const paymentFilter = (el('fcal-filter-payment') || {}).value || ''
      const searchVal     = ((el('fcal-search')        || {}).value || '').toLowerCase()

      filtered = allTransactions.filter(t => {
        if (typeFilter && t.type !== typeFilter) return false
        if (blockFilter && t.block !== blockFilter) return false
        if (paymentFilter && t._raw && t._raw.source !== paymentFilter) return false
        if (searchVal && !(t.article + ' ' + t.category + ' ' + t.comment).toLowerCase().includes(searchVal)) return false
        return true
      })

      filtered.sort((a, b) => {
        const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
        if (typeof av === 'number') return (av - bv) * sortDir
        if (av < bv) return -sortDir
        if (av > bv) return  sortDir
        return 0
      })

      page = 0
      renderPage()
    }

    const renderPage = () => {
      const tbody = el('fcal-table-body')
      const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

      if (tbody) {
        tbody.innerHTML = pageSlice.map(t => {
          const isExp = t.type === 'expense'
          const typeLabel = isExp
            ? '<span style="color:#EF4444">Расход</span>'
            : '<span style="color:#10B981">Приход</span>'
          const amtColor = isExp ? '#EF4444' : '#10B981'
          return `<tr>
            <td>${t.date}</td>
            <td>${typeLabel}</td>
            <td style="font-size:12px">${t.article || '—'}</td>
            <td style="font-size:12px">${t.category || '—'}</td>
            <td class="num" style="color:${amtColor};font-weight:600">${isExp ? '-' : ''}${f.money(t.amount)}</td>
            <td style="font-size:11px;color:var(--text-muted)">${t.comment || '—'}</td>
          </tr>`
        }).join('')
      }

      const pag = el('fcal-pagination')
      if (pag) {
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
        pag.innerHTML = `
          <span style="font-size:12px;color:var(--text-muted)">
            ${filtered.length} транзакций · стр. ${page + 1} из ${Math.max(1, totalPages)}
          </span>
          ${page > 0 ? '<button onclick="window._fcalPrev()" style="margin-left:8px;padding:4px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:12px;cursor:pointer">← Пред</button>' : ''}
          ${(page + 1) < totalPages ? '<button onclick="window._fcalNext()" style="margin-left:6px;padding:4px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:12px;cursor:pointer">След →</button>' : ''}
        `
      }
    }

    global._fcalPrev = () => { if (page > 0) { page--; renderPage() } }
    global._fcalNext = () => { page++; renderPage() }

    // ── DDS KPIs + Monthly Summary ──────────────────────────────────────────
    // Переменные вынесены из блока if(FD) чтобы быть доступными в heatmap/bipolar ниже
    let calRevenue = new Array(12).fill(0)
    let calExpense = new Array(12).fill(0)
    let calWithdrawal = new Array(12).fill(0)

    if (FD) {
      const LABELS = FD.MONTHS_SHORT
      const sumArr = arr => arr.reduce((s, v) => s + v, 0)
      if (is2026) {
        // 2026: факт из DDS, план для месяцев без данных
        const dCal26 = FD.getMonthlyData(rawData && rawData.dds, 2026)
        const st26 = SE ? SE.getState() : {}
        const fb26 = FD.getCostBlockTotals(rawData && rawData.dds, 2025)
        const planCosts = SE ? SE.computeMonthlyCosts(fb26, st26.costOpt || {}, st26.revenueGrowthPct, st26.inflationPct || 0) : null
        const planRev = SE ? SE.computeMonthlyRevenue(FD.TOTALS_2025.revenue, st26.revenueGrowthPct) : new Array(12).fill(0)

        // Факт если > 0, иначе план
        calRevenue = dCal26.revenue.map((fv, i) => fv > 0 ? fv : planRev[i])
        calExpense = dCal26.opExpense.map((fv, i) => fv > 0 ? fv : (planCosts ? planCosts.byMonth[i] : 0))
        calWithdrawal = dCal26.withdrawal.map((fv, i) => fv > 0 ? fv : (st26.withdrawalLimit || 0))
      } else {
        const dCal = FD.FACT_2025_MONTHLY
        calRevenue = dCal.revenue
        calExpense = dCal.opExpense
        calWithdrawal = dCal.withdrawal
      }

      const totalRev = sumArr(calRevenue)
      const totalExp = sumArr(calExpense)
      const totalWd = sumArr(calWithdrawal)
      const cashGap = totalRev - totalExp - totalWd

      // KPI cards
      const calKpis = el('fcal-kpis')
      if (calKpis) {
        const yearLabel = is2026 ? ' (план)' : ''
        calKpis.innerHTML =
          kpiCard('Доходы за год' + yearLabel,  fmtCompact(totalRev),  '', 'green') +
          kpiCard('Расходы за год' + yearLabel, fmtCompact(totalExp),  '', 'red') +
          kpiCard('Вывод средств',  fmtCompact(totalWd),  '', 'orange') +
          kpiCard('Кассовый разрыв', fmtCompact(cashGap), '', cashGap >= 0 ? 'green' : 'red')
      }

      // Monthly DDS summary table
      const ddsSummary = el('fcal-dds-summary')
      if (ddsSummary) {
        const monthBalance = calRevenue.map((r, i) => r - calExpense[i] - calWithdrawal[i])
        ddsSummary.innerHTML = `
          <table class="data-table" style="font-size:12px">
            <thead>
              <tr>
                <th style="min-width:100px">Статья</th>
                ${LABELS.map(l => `<th class="num" style="font-size:11px;min-width:68px">${l}</th>`).join('')}
                <th class="num" style="font-weight:700;min-width:80px">ИТОГО</th>
              </tr>
            </thead>
            <tbody>
              <tr style="color:#10B981;font-weight:600">
                <td>Доходы</td>
                ${calRevenue.map(v => `<td class="num">${fmtCompact(v)}</td>`).join('')}
                <td class="num">${fmtCompact(sumArr(calRevenue))}</td>
              </tr>
              <tr style="color:#EF4444">
                <td>Расходы</td>
                ${calExpense.map(v => `<td class="num">${fmtCompact(v)}</td>`).join('')}
                <td class="num">${fmtCompact(sumArr(calExpense))}</td>
              </tr>
              <tr style="color:#9CA3AF">
                <td>Вывод</td>
                ${calWithdrawal.map(v => `<td class="num">${fmtCompact(v)}</td>`).join('')}
                <td class="num">${fmtCompact(sumArr(calWithdrawal))}</td>
              </tr>
              <tr style="font-weight:700;border-top:2px solid rgba(0,0,0,.08)">
                <td>Остаток месяца</td>
                ${monthBalance.map(v => `<td class="num" style="color:${v >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(v)}</td>`).join('')}
                <td class="num" style="color:${sumArr(monthBalance) >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(sumArr(monthBalance))}</td>
              </tr>
              ${(() => {
                let cum = 0
                const cumArr = monthBalance.map(v => { cum += v; return cum })
                return `<tr style="font-weight:700;background:#F5F3FF">
                  <td>Кумулятив</td>
                  ${cumArr.map(v => `<td class="num" style="color:${v >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(v)}</td>`).join('')}
                  <td class="num" style="color:${cumArr[11] >= 0 ? '#10B981' : '#EF4444'}">${fmtCompact(cumArr[11])}</td>
                </tr>`
              })()}
            </tbody>
          </table>`
      }

      // Monthly bar chart: Revenue vs Expenses
      const monthlyBarCtx = el('chart-fcal-monthly-bar')
      if (monthlyBarCtx) {
        makeChart(monthlyBarCtx.getContext('2d'), {
          type: 'bar',
          data: {
            labels: LABELS,
            datasets: [
              { label: 'Доходы', data: calRevenue, backgroundColor: '#10B981', borderRadius: 4 },
              { label: 'Расходы', data: calExpense, backgroundColor: '#EF4444', borderRadius: 4 },
              { label: 'Вывод', data: calWithdrawal, backgroundColor: '#D1D5DB', borderRadius: 4 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
              tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.raw)}` } }
            },
            scales: {
              y: { ticks: { callback: v => fmtCompact(v), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
              x: { ticks: { font: { size: 11 } } }
            }
          }
        })
      }
    }

    // ── GitHub-style calendar heatmap (daily cashflow) ────────────────────────
    const hmEl = el('fcal-heatmap')
    if (hmEl && FD) {
      // Build daily data from monthly — distribute revenue & expense evenly across days
      const dailyMap = {}  // date → { income, expense, cashflow }
      const hmMonthDays = [31,28,31,30,31,30,31,31,30,31,30,31]
      calRevenue.forEach((rev, mi) => {
        const days = hmMonthDays[mi]
        const dailyRev = rev / days
        const dailyExp = calExpense[mi] / days
        for (let day = 1; day <= days; day++) {
          const mm = String(mi + 1).padStart(2, '0')
          const dd = String(day).padStart(2, '0')
          const key = `${selectedYear}-${mm}-${dd}`
          dailyMap[key] = { income: dailyRev, expense: dailyExp, cashflow: dailyRev - dailyExp }
        }
      })

      // Override income from real transactions if available (only for 2025)
      if (!is2026 && rawTransactions.length > 0) {
        const txByDate = {}
        rawTransactions.forEach(t => {
          if (!t.date) return
          txByDate[t.date] = (txByDate[t.date] || 0) + (t.amount || 0)
        })
        Object.entries(txByDate).forEach(([date, amt]) => {
          if (dailyMap[date]) {
            dailyMap[date].income = amt
            dailyMap[date].cashflow = amt - dailyMap[date].expense
          } else {
            dailyMap[date] = { income: amt, expense: 0, cashflow: amt }
          }
        })
      }

      const dailyEntries = Object.values(dailyMap)
      const cashflows = dailyEntries.map(d => d.cashflow)
      const maxAbs = Math.max(Math.abs(Math.min(...cashflows)), Math.abs(Math.max(...cashflows))) || 1

      // Build weeks grid (GitHub-style: 53 cols × 7 rows)
      const startDate = new Date(selectedYear, 0, 1)
      const startDow = startDate.getDay() // 0=Sun
      const cfMap = dailyMap

      const MONTH_LABELS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
      const DAY_LABELS = ['Вс','Пн','','Ср','','Пт','']

      let cells = ''
      let monthMarkers = ''
      let lastMonth = -1
      const cellSize = 13, gap = 2

      for (let week = 0; week < 53; week++) {
        for (let dow = 0; dow < 7; dow++) {
          const idx = week * 7 + dow - startDow
          if (idx < 0 || idx >= 365) continue
          const dt = new Date(selectedYear, 0, 1 + idx)
          const key = dt.toISOString().slice(0, 10)
          const entry = cfMap[key] || { income: 0, expense: 0, cashflow: 0 }
          const cf = entry.cashflow
          const intensity = Math.min(Math.abs(cf) / maxAbs, 1)
          const alpha = 0.15 + intensity * 0.75
          const color = cf >= 0
            ? `rgba(16,185,129,${alpha.toFixed(2)})`
            : `rgba(220,38,38,${alpha.toFixed(2)})`
          const x = week * (cellSize + gap) + 28
          const y = dow * (cellSize + gap) + 20
          const tip = `${key}\nПриход: +${fmtCompact(entry.income)}\nРасход: -${fmtCompact(entry.expense)}\nИтого: ${cf >= 0 ? '+' : ''}${fmtCompact(cf)}`
          cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}" data-date="${key}" data-cf="${Math.round(cf)}"><title>${tip}</title></rect>`

          // Month label
          if (dt.getMonth() !== lastMonth) {
            lastMonth = dt.getMonth()
            monthMarkers += `<text x="${x}" y="12" font-size="10" fill="var(--text-muted)">${MONTH_LABELS[lastMonth]}</text>`
          }
        }
      }

      // Day labels
      let dayLabels = ''
      DAY_LABELS.forEach((lbl, i) => {
        if (lbl) dayLabels += `<text x="0" y="${i * (cellSize + gap) + 20 + 10}" font-size="10" fill="var(--text-muted)">${lbl}</text>`
      })

      const svgW = 53 * (cellSize + gap) + 28
      const svgH = 7 * (cellSize + gap) + 24
      hmEl.innerHTML = `
        <div style="padding:8px 0;overflow-x:auto">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
            Денежный поток ${selectedYear} по дням (<span style="color:#10B981">■</span> приход &gt; расход, <span style="color:#DC2626">■</span> расход &gt; приход)
          </div>
          <svg width="${svgW}" height="${svgH}" style="font-family:Inter,system-ui,sans-serif">
            ${dayLabels}${monthMarkers}${cells}
          </svg>
          <div style="margin-top:8px;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">
            Меньше <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(220,38,38,0.6)"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(220,38,38,0.2)"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(200,200,200,0.3)"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(16,185,129,0.2)"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(16,185,129,0.6)"></span> Больше
            · Пик: ${FD.TOTALS_2025.peakMonth} · Дефицит в янв, фев, авг
          </div>
        </div>`
    }

    // ── Bipolar bar chart (daily income & expenses) ─────────────────────────────
    const bipCtx = el('chart-fcal-bipolar')
    if (bipCtx) {
      // Aggregate income by date
      const incomeByDate = {}
      const expenseByDate = {}
      const bipMonthDays = [31,28,31,30,31,30,31,31,30,31,30,31]

      // cashLedger — ежедневные данные из Excel
      const cashLedger = (rawData && rawData.cashLedger) || []
      const yearLedger = cashLedger.filter(e => e.date && e.date.startsWith(String(selectedYear)))

      if (yearLedger.length > 0) {
        // Используем реальные ежедневные данные
        yearLedger.forEach(e => {
          if (e.income > 0) incomeByDate[e.date] = (incomeByDate[e.date] || 0) + e.income
          if (e.expense > 0) expenseByDate[e.date] = (expenseByDate[e.date] || 0) + e.expense
        })
      } else {
        // Fallback: транзакции для приходов, DDS для расходов
        rawTransactions.forEach(t => {
          if (!t.date) return
          incomeByDate[t.date] = (incomeByDate[t.date] || 0) + (t.amount || 0)
        })
        calExpense.forEach((monthExp, mi) => {
          if (!monthExp || monthExp <= 0) return
          const days = bipMonthDays[mi]
          const daily = monthExp / days
          for (let day = 1; day <= days; day++) {
            const key = `${selectedYear}-${String(mi+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            expenseByDate[key] = daily
          }
        })
      }

      // Build sorted dates from union
      const allDates = new Set([...Object.keys(incomeByDate), ...Object.keys(expenseByDate)])
      const dates = [...allDates].sort()

      makeChart(bipCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: dates.map(d => d.slice(5)),
          datasets: [
            {
              label: 'Приход',
              data: dates.map(d => incomeByDate[d] || 0),
              backgroundColor: '#10B981',
              borderWidth: 0,
              borderRadius: 2
            },
            {
              label: 'Расход',
              data: dates.map(d => -(expenseByDate[d] || 0)),
              backgroundColor: '#EF4444',
              borderWidth: 0,
              borderRadius: 2
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
            tooltip: { callbacks: {
              title: ctx => dates[ctx[0].dataIndex],
              label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(Math.abs(ctx.raw))}`
            }}
          },
          scales: {
            y: { ticks: { callback: v => fmtCompact(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
            x: { ticks: { maxTicksLimit: 20, font: { size: 10 } } }
          }
        }
      })
    }

    // Bind filters
    setTimeout(() => {
      ;['fcal-filter-block', 'fcal-filter-type', 'fcal-filter-payment', 'fcal-search'].forEach(id => {
        const inp = el(id)
        if (inp) inp.addEventListener('change', filterAndRender)
        if (inp) inp.addEventListener('input',  filterAndRender)
      })

      // Year selector
      const yearSel = el('fcal-year-select')
      if (yearSel) yearSel.addEventListener('change', () => renderCalendar())

      // Sort headers
      document.querySelectorAll('#fcal-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort
          if (sortKey === key) sortDir *= -1
          else { sortKey = key; sortDir = 1 }
          filterAndRender()
        })
      })

      filterAndRender()
    }, 50)

    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'
  }

  // ─── TREE TABLE HELPER ────────────────────────────────────────────────────
  function _renderTreeTable (container, tree, totalCogs, f, monthlyByBlock) {
    const expanded = {}

    // Sparkline renderer: draws a mini line chart into a canvas
    const drawSparkline = (canvasId, values, color) => {
      setTimeout(() => {
        const cvs = document.getElementById(canvasId)
        if (!cvs) return
        const ctx = cvs.getContext('2d')
        const w = cvs.width, h = cvs.height
        const max = Math.max(...values, 1)
        const min = Math.min(...values, 0)
        const range = max - min || 1
        ctx.clearRect(0, 0, w, h)
        ctx.strokeStyle = color || '#8280FF'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        values.forEach((v, i) => {
          const x = (i / (values.length - 1)) * w
          const y = h - ((v - min) / range) * (h - 4) - 2
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
        // Fill area
        ctx.lineTo(w, h)
        ctx.lineTo(0, h)
        ctx.closePath()
        ctx.fillStyle = (color || '#8280FF') + '18'
        ctx.fill()
      }, 30)
    }

    let sparkId = 0
    const sparklines = [] // {id, values, color}

    const render = () => {
      const rows = []
      sparklines.length = 0
      sparkId = 0
      rows.push(`
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="min-width:220px">Статья</th>
              <th class="num">Сумма</th>
              <th class="num">% COGS</th>
              <th class="num">% выручки</th>
              <th style="width:80px;text-align:center">Тренд</th>
            </tr>
          </thead>
          <tbody>`)

      tree.forEach(block => {
        const blockPct = (block.total / totalCogs * 100).toFixed(1)
        const revPct   = (block.total / 101_065_615 * 100).toFixed(1)
        const isOpen   = expanded[block.id]
        const sid = 'spark-' + (sparkId++)
        const blockMonthly = monthlyByBlock && monthlyByBlock[block.id]
          ? monthlyByBlock[block.id]
          : new Array(12).fill(block.total / 12)
        sparklines.push({ id: sid, values: blockMonthly, color: block.color })
        rows.push(`
          <tr class="tree-row--l0" style="cursor:pointer" data-toggle="${block.id}">
            <td>
              <span class="tree-toggle">${isOpen ? '▼' : '▶'}</span>
              <span class="cost-dot" style="background:${block.color}"></span>
              <strong>${block.label}</strong>
            </td>
            <td class="num"><strong>${fmtCompact(block.total)}</strong></td>
            <td class="num"><strong>${blockPct}%</strong></td>
            <td class="num">${revPct}%</td>
            <td style="text-align:center"><canvas id="${sid}" width="64" height="20" style="vertical-align:middle"></canvas></td>
          </tr>`)

        if (isOpen) {
          block.children.forEach(sub => {
            const subPct = (sub.total / totalCogs * 100).toFixed(1)
            const isSubOpen = expanded[sub.id]
            rows.push(`
              <tr class="tree-row--l1" style="cursor:pointer" data-toggle="${sub.id}">
                <td style="padding-left:28px">
                  <span class="tree-toggle">${sub.children && sub.children.length ? (isSubOpen ? '▼' : '▶') : '·'}</span>
                  ${sub.label}
                </td>
                <td class="num">${fmtCompact(sub.total)}</td>
                <td class="num">${subPct}%</td>
                <td class="num">—</td>
                <td></td>
              </tr>`)

            if (isSubOpen && sub.children) {
              sub.children.forEach(item => {
                rows.push(`
                  <tr class="tree-row--l2">
                    <td style="padding-left:52px;font-size:12px;color:var(--text-secondary)">${item.label}</td>
                    <td class="num" style="font-size:12px">${fmtCompact(item.total)}</td>
                    <td class="num" style="font-size:12px">${(item.total / totalCogs * 100).toFixed(2)}%</td>
                    <td class="num">—</td>
                    <td></td>
                  </tr>`)
              })
            }
          })
        }
      })

      rows.push('</tbody></table>')
      container.innerHTML = rows.join('')

      // Draw sparklines after DOM update
      sparklines.forEach(s => drawSparkline(s.id, s.values, s.color))

      container.querySelectorAll('[data-toggle]').forEach(tr => {
        tr.addEventListener('click', () => {
          const id = tr.dataset.toggle
          expanded[id] = !expanded[id]
          render()
        })
      })
    }

    render()
  }

  // ─── HEATMAP HELPER ───────────────────────────────────────────────────────
  function _renderHeatmap (container, byBlock, BLOCK_KEYS, BLOCK_META, labels) {
    const maxVal = Math.max(...BLOCK_KEYS.flatMap(k => byBlock[k] || []))

    const hexToRgbArr = hex => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ]

    const cellStyle = (val, color) => {
      const intensity = maxVal > 0 ? val / maxVal : 0
      const [r, g, b] = hexToRgbArr(color)
      const alpha = 0.1 + intensity * 0.75
      return `background:rgba(${r},${g},${b},${alpha});color:${intensity > 0.6 ? '#fff' : 'inherit'}`
    }

    container.innerHTML = `
      <div class="fin-heatmap">
        <table>
          <thead>
            <tr>
              <th>Блок</th>
              ${labels.map(l => `<th>${l}</th>`).join('')}
              <th>Итого</th>
            </tr>
          </thead>
          <tbody>
            ${BLOCK_KEYS.map(k => {
              const meta = BLOCK_META[k]
              const vals = byBlock[k] || new Array(12).fill(0)
              const total = vals.reduce((s, v) => s + v, 0)
              return `<tr>
                <td>${meta.label}</td>
                ${vals.map(v => `<td style="${cellStyle(v, meta.color)}" title="${fmtCompact(v)}">${v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v || 0}</td>`).join('')}
                <td style="font-weight:600">${fmtCompact(total)}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>`
  }

  // ─── Экспорт ──────────────────────────────────────────────────────────────
  global.FinanceDashboard = {
    renderOverview,
    renderFinance2025,
    renderFinance2026,
    renderCalendar,
    renderCost
  }

})(window)
