;(function (global) {
  const qs = (sel) => document.querySelector(sel)
  const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0))
  const fmtMoney = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + ' ₸'
  const fmtPct = (n) => (n != null ? (n).toFixed(1) + '%' : '—')

  const trafficLight = (pct) => {
    if (pct >= 90) return 'good'
    if (pct >= 60) return 'warn'
    return 'bad'
  }

  const CHART_COLORS = {
    new: 'rgba(56, 189, 248, 0.85)',
    repeat: 'rgba(99, 102, 241, 0.85)',
    bars: ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#06b6d4']
  }

  // Цвета уровней воронки (сверху вниз)
  const FUNNEL_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#22c55e', '#38bdf8']

  let chartNewRepeat = null
  let chartRejection = null

  // Debounce helper
  const debounce = (fn, ms) => {
    let timer
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
  }

  // ─── SVG ВОРОНКА ───────────────────────────────────────────────────────────
  const renderFunnelSVG = (funnel6, handlers) => {
    const host = qs('#funnel-svg-host')
    if (!host) return
    host.innerHTML = ''

    const W = host.clientWidth || 600
    const LAYER_H = 72
    const GAP = 4
    const totalH = funnel6.length * (LAYER_H + GAP)
    const MAX_W_RATIO = 0.96
    const MIN_W_RATIO = 0.32

    // Найдём максимальный count для масштабирования
    const maxCount = Math.max(...funnel6.map((f) => f.count || 1), 1)

    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${totalH}`)
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', totalH)
    svg.setAttribute('class', 'funnel-svg')

    // Tooltip элемент
    let tooltip = qs('#funnel-tooltip')
    if (!tooltip) {
      tooltip = document.createElement('div')
      tooltip.id = 'funnel-tooltip'
      tooltip.className = 'funnel-tooltip'
      document.body.appendChild(tooltip)
    }

    funnel6.forEach((level, i) => {
      const countVal = level.count != null ? level.count : maxCount
      const ratio = Math.max(MIN_W_RATIO, Math.min(MAX_W_RATIO, (countVal / maxCount) * MAX_W_RATIO))
      // Для финансового уровня (нет count) — самый узкий
      const widthPx = level.count == null ? W * MIN_W_RATIO : W * ratio
      const x = (W - widthPx) / 2
      const y = i * (LAYER_H + GAP)

      const g = document.createElementNS(svgNS, 'g')
      g.setAttribute('class', 'funnel-layer')
      g.setAttribute('data-stage', level.stage)
      g.style.cursor = handlers ? 'pointer' : 'default'

      // Трапеция через polygon
      const nextRatio = i < funnel6.length - 1
        ? Math.max(MIN_W_RATIO, Math.min(MAX_W_RATIO, ((funnel6[i + 1].count != null ? funnel6[i + 1].count : 1) / maxCount) * MAX_W_RATIO))
        : MIN_W_RATIO
      const nextWidth = funnel6[i + 1] && funnel6[i + 1].count == null ? W * MIN_W_RATIO : W * nextRatio
      const nextX = (W - nextWidth) / 2

      const points = [
        `${x},${y}`,
        `${x + widthPx},${y}`,
        `${nextX + nextWidth},${y + LAYER_H}`,
        `${nextX},${y + LAYER_H}`
      ].join(' ')

      const poly = document.createElementNS(svgNS, 'polygon')
      poly.setAttribute('points', points)
      poly.setAttribute('fill', FUNNEL_COLORS[i])
      poly.setAttribute('opacity', '0.85')

      // Основной текст
      const textY = y + LAYER_H / 2
      const label = document.createElementNS(svgNS, 'text')
      label.setAttribute('x', W / 2)
      label.setAttribute('y', textY - 8)
      label.setAttribute('class', 'funnel-label funnel-label--main')
      label.textContent = level.label

      const valueText = document.createElementNS(svgNS, 'text')
      valueText.setAttribute('x', W / 2)
      valueText.setAttribute('y', textY + 10)
      valueText.setAttribute('class', 'funnel-label funnel-label--value')
      if (level.count != null) {
        valueText.textContent = fmt(level.count) + (level.amount > 0 ? ` · ${fmtMoney(level.amount)}` : '')
      } else {
        valueText.textContent = fmtMoney(level.amount)
      }

      // Конверсия с предыдущего этапа
      if (level.convFrom != null) {
        const convEl = document.createElementNS(svgNS, 'text')
        convEl.setAttribute('x', W / 2)
        convEl.setAttribute('y', y - 2)
        convEl.setAttribute('class', 'funnel-label funnel-label--conv')
        convEl.textContent = `↓ ${level.convFrom}%`
        svg.appendChild(convEl)
      }

      g.appendChild(poly)
      g.appendChild(label)
      g.appendChild(valueText)

      if (handlers && handlers.onDrillStage) {
        g.addEventListener('click', () => handlers.onDrillStage(level.stage))
      }

      // Hover tooltip
      g.addEventListener('mouseenter', (e) => {
        tooltip.innerHTML = `<strong>${level.label}</strong><br>${level.count != null ? fmt(level.count) + ' обращений' : ''} ${level.amount > 0 ? '<br>' + fmtMoney(level.amount) : ''}${level.convFrom != null ? '<br>Конверсия: ' + fmtPct(level.convFrom) : ''}`
        tooltip.style.display = 'block'
      })
      g.addEventListener('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 12) + 'px'
        tooltip.style.top = (e.clientY - 8) + 'px'
      })
      g.addEventListener('mouseleave', () => { tooltip.style.display = 'none' })

      svg.appendChild(g)
    })

    host.appendChild(svg)
  }

  // ─── KPI КАРТОЧКИ ───────────────────────────────────────────────────────────
  const renderKPIStrip = (kpiCards) => {
    const host = qs('#sales-kpi-strip')
    if (!host) return

    const cards = [
      { label: 'Заказы (месяц)', value: `${fmt(kpiCards.ordersMonth.fact)} / ${fmt(kpiCards.ordersMonth.plan)}`, pct: kpiCards.ordersMonth.pct },
      { label: 'Выручка (месяц)', value: `${fmtMoney(kpiCards.revenueMonth.fact)}`, sub: `план: ${fmtMoney(kpiCards.revenueMonth.plan)}`, pct: kpiCards.revenueMonth.pct },
      { label: 'Средний чек', value: fmtMoney(kpiCards.avgCheck.fact), sub: `план: ${fmtMoney(kpiCards.avgCheck.plan)}`, pct: kpiCards.avgCheck.plan > 0 ? Math.round((kpiCards.avgCheck.fact / kpiCards.avgCheck.plan) * 100) : 0 },
      { label: 'Конверсия', value: fmtPct(kpiCards.conversionRate.value), sub: `план: ${fmtPct(kpiCards.conversionRate.plan)}`, pct: kpiCards.conversionRate.plan > 0 ? Math.round((kpiCards.conversionRate.value / kpiCards.conversionRate.plan) * 100) : 0 },
      { label: 'Новых клиентов', value: fmt(kpiCards.newClients.count), sub: `план: ~${fmt(kpiCards.newClients.plan)}`, pct: kpiCards.newClients.plan > 0 ? Math.round((kpiCards.newClients.count / kpiCards.newClients.plan) * 100) : 0 }
    ]

    host.innerHTML = cards.map((c) => {
      const tl = trafficLight(c.pct)
      const barPct = Math.min(100, c.pct || 0)
      return `<div class="tile tile--kpi">
  <span>${c.label}</span>
  <strong>${c.value}</strong>
  ${c.sub ? `<small>${c.sub}</small>` : ''}
  <div class="progress"><div class="progress__bar progress__bar--${tl}" style="width:${barPct}%"></div></div>
  <small class="kpi-pct kpi-pct--${tl}">${fmtPct(c.pct)}</small>
</div>`
    }).join('')
  }

  // ─── ТАБЛИЦА МЕНЕДЖЕРОВ (расширенная) ────────────────────────────────────
  const renderManagersTable = (managerExtended) => {
    const tbody = qs('#tbody-sales-managers')
    if (!tbody) return
    tbody.innerHTML = managerExtended.map((m) => `<tr>
  <td><strong>${m.name}</strong></td>
  <td>${fmt(m.leads)}</td>
  <td>${fmt(m.orders)}</td>
  <td><span class="badge badge--${trafficLight(m.conversion)}">${fmtPct(m.conversion)}</span></td>
  <td>${fmtMoney(m.revenue)}</td>
  <td>${fmtMoney(m.avgCheck)}</td>
  <td>${fmt(m.missedCalls)}</td>
  <td>${fmt(m.rejections)}</td>
  <td>${fmt(m.callbacks)} <small>(${fmtPct(m.callbackPct)})</small></td>
</tr>`).join('')
  }

  // ─── ТАБЛИЦА КАНАЛОВ ────────────────────────────────────────────────────
  const renderChannelsTable = (channelTable) => {
    const tbody = qs('#tbody-sales-channels')
    if (!tbody) return
    tbody.innerHTML = channelTable.map((c) => `<tr>
  <td><strong>${c.label}</strong></td>
  <td>${fmt(c.leads)}</td>
  <td>${fmt(c.orders)}</td>
  <td><span class="badge badge--${trafficLight(c.conversion)}">${fmtPct(c.conversion)}</span></td>
  <td>${fmtMoney(c.amount)}</td>
  <td>${fmtMoney(c.avgCheck)}</td>
  <td>${c.cac != null ? fmtMoney(c.cac) : '—'}</td>
</tr>`).join('')
  }

  // ─── DONUT: Новые vs Повторные ───────────────────────────────────────────
  const renderNewRepeatChart = (newVsRepeat) => {
    const canvas = qs('#chart-new-repeat')
    if (!canvas) return
    if (chartNewRepeat) { chartNewRepeat.destroy(); chartNewRepeat = null }

    const totalOrders = newVsRepeat.new.count + newVsRepeat.repeat.count
    if (totalOrders === 0) { canvas.parentElement.innerHTML = '<p style="color:var(--muted);padding:1rem">Нет данных</p>'; return }

    const newPct = totalOrders > 0 ? Math.round((newVsRepeat.new.count / totalOrders) * 100) : 0
    const repPct = 100 - newPct

    chartNewRepeat = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: [`Новые (${newPct}%)`, `Повторные (${repPct}%)`],
        datasets: [{
          data: [newVsRepeat.new.count, newVsRepeat.repeat.count],
          backgroundColor: [CHART_COLORS.new, CHART_COLORS.repeat],
          borderWidth: 2,
          borderColor: 'var(--panel)'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const isNew = ctx.dataIndex === 0
                const data = isNew ? newVsRepeat.new : newVsRepeat.repeat
                return [`${ctx.label}`, `Заказов: ${fmt(data.count)}`, `Выручка: ${fmtMoney(data.revenue)}`, `Ср.чек: ${fmtMoney(data.avgCheck)}`]
              }
            }
          }
        }
      }
    })

    // Центральный текст
    const parentEl = canvas.parentElement
    if (!parentEl.querySelector('.donut-center')) {
      const center = document.createElement('div')
      center.className = 'donut-center'
      center.innerHTML = `<small>CAC blended</small><strong>${fmtMoney(newVsRepeat.blendedCAC)}</strong>`
      parentEl.style.position = 'relative'
      parentEl.appendChild(center)
    } else {
      parentEl.querySelector('.donut-center strong').textContent = fmtMoney(newVsRepeat.blendedCAC)
    }
  }

  // ─── HORIZONTAL BAR: Причины отказов ────────────────────────────────────
  const renderRejectionChart = (rejectionReasons) => {
    const canvas = qs('#chart-rejection-reasons')
    if (!canvas) return
    if (chartRejection) { chartRejection.destroy(); chartRejection = null }
    if (!rejectionReasons.length) { canvas.parentElement.innerHTML = '<p style="color:var(--muted);padding:1rem">Нет данных</p>'; return }

    const top = rejectionReasons.slice(0, 6)
    chartRejection = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top.map((r) => r.reason),
        datasets: [{
          label: 'Кол-во отказов',
          data: top.map((r) => r.count),
          backgroundColor: top.map((_, i) => CHART_COLORS.bars[i % CHART_COLORS.bars.length]),
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = top[ctx.dataIndex]
                return `${ctx.formattedValue} (${fmtPct(r.pctOfRejections)} от отказов)`
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51,65,85,0.5)' } },
          y: { ticks: { color: '#e2e8f0' }, grid: { display: false } }
        }
      }
    })
  }

  // ─── ПРОГРЕСС ТРЕКЕР ────────────────────────────────────────────────────
  const renderProgressTracker = (progressTracker) => {
    const host = qs('#progress-tracker')
    if (!host) return
    host.innerHTML = progressTracker.map((row) => {
      const oTl = trafficLight(row.orderPct)
      const rTl = trafficLight(row.revenuePct)
      const oPct = Math.min(100, row.orderPct || 0)
      const rPct = Math.min(100, row.revenuePct || 0)
      return `<div class="progress-row">
  <div class="progress-row__label">${row.label}</div>
  <div class="progress-row__bars">
    <div class="progress-bar-wrap">
      <span class="progress-bar-wrap__caption">Заказы: ${fmt(row.orders)} / ${fmt(row.ordersTarget)}</span>
      <div class="progress"><div class="progress__bar progress__bar--${oTl}" style="width:${oPct}%"></div></div>
      <span class="progress-bar-wrap__pct progress__pct--${oTl}">${fmtPct(row.orderPct)}</span>
    </div>
    <div class="progress-bar-wrap">
      <span class="progress-bar-wrap__caption">Выручка: ${fmtMoney(row.revenue)} / ${fmtMoney(row.revenueTarget)}</span>
      <div class="progress"><div class="progress__bar progress__bar--${rTl}" style="width:${rPct}%"></div></div>
      <span class="progress-bar-wrap__pct progress__pct--${rTl}">${fmtPct(row.revenuePct)}</span>
    </div>
  </div>
</div>`
    }).join('')
  }

  // ─── ПЛАН/ФАКТ ТАБЛИЦА ───────────────────────────────────────────────────
  const renderPlanFactTable = (planFactFull) => {
    const host = qs('#plan-fact-table-host')
    if (!host) return
    const rows = planFactFull.map((row) => {
      if (row.isWeekSubtotal) {
        return `<tr class="row--subtotal">
  <td colspan="2"><strong>${row.date}</strong></td>
  <td>${fmt(row.orderTarget)}</td><td>${fmt(row.orderFact)}</td>
  <td class="${row.orderFact >= row.orderTarget ? 'cell--good' : 'cell--bad'}">${row.orderFact >= row.orderTarget ? '+' : ''}${fmt(row.orderFact - row.orderTarget)}</td>
  <td>${fmtMoney(row.revenueTarget)}</td><td>${fmtMoney(row.revenueFact)}</td>
  <td>—</td><td colspan="2">—</td>
</tr>`
      }
      const delta = (row.orderFact || 0) - row.orderTarget
      const isFuture = !row.isPast
      return `<tr${isFuture ? ' style="opacity:0.45"' : ''}>
  <td>${row.day}</td>
  <td>${row.date}</td>
  <td>${fmt(row.orderTarget)}</td>
  <td>${isFuture ? '—' : fmt(row.orderFact)}</td>
  <td class="${delta >= 0 ? 'cell--good' : 'cell--bad'}">${isFuture ? '—' : (delta >= 0 ? '+' : '') + fmt(delta)}</td>
  <td>${fmtMoney(row.revenueTarget)}</td>
  <td>${isFuture ? '—' : fmtMoney(row.revenueFact)}</td>
  <td>—</td>
  <td>${fmt(row.cumOrderTarget)}</td>
  <td>${isFuture ? '—' : fmtMoney(row.cumRevenueTarget)}</td>
</tr>`
    }).join('')

    host.innerHTML = `<table class="data-table data-table--planfact">
  <thead><tr>
    <th>#</th><th>Дата</th>
    <th>План заказов</th><th>Факт заказов</th><th>Δ</th>
    <th>План выручки</th><th>Факт выручки</th><th>Δ</th>
    <th>Накопл. план</th><th>Накопл. выручка план</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`
  }

  // ─── РЕДАКТИРУЕМОЕ ПЛАНИРОВАНИЕ ─────────────────────────────────────────
  const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  const renderPlanEditor = (planParams, onUpdate) => {
    const host = qs('#plan-edit-host')
    if (!host) return

    const p = planParams
    host.innerHTML = `
<div class="plan-editor">
  <div class="plan-editor__grid">
    <label class="field field--editable">
      <span>Годовая выручка (₸)</span>
      <input type="number" id="pe-yearRevenue" value="${p.yearRevenue}" step="1000000" />
    </label>
    <label class="field field--editable">
      <span>Годовые заказы</span>
      <input type="number" id="pe-yearOrders" value="${p.yearOrders}" step="100" />
    </label>
    <label class="field field--editable">
      <span>Целевой ср. чек (₸)</span>
      <input type="number" id="pe-targetAvgCheck" value="${p.targetAvgCheck}" step="1000" />
    </label>
    <label class="field field--editable">
      <span>Целевая конверсия (%)</span>
      <input type="number" id="pe-targetConversion" value="${Math.round(p.targetConversion * 100)}" min="1" max="100" step="1" />
    </label>
    <label class="field field--editable">
      <span>Лимит вывода/мес (₸)</span>
      <input type="number" id="pe-withdrawalCap" value="${p.withdrawalCap}" step="50000" />
    </label>
    <label class="field field--editable">
      <span>Рост %</span>
      <input type="number" id="pe-growthPct" value="${p.growthPct}" min="-50" max="500" step="5" />
    </label>
  </div>
  <h4 style="margin:0.75rem 0 0.4rem;font-size:0.88rem;color:var(--muted)">Сезонные коэффициенты</h4>
  <div class="plan-editor__seasonal">
    ${MONTHS_RU.map((m, i) => `<label class="field field--editable field--seasonal">
      <span>${m}</span>
      <input type="number" id="pe-seasonal-${i}" value="${p.seasonal[i] || 1}" min="0.1" max="3" step="0.05" />
    </label>`).join('')}
  </div>
  <p class="hint">Жёлтые поля — редактируемые. Данные сохраняются в браузере. Изменения пересчитывают прогресс и план по дням мгновенно.</p>
</div>`

    const debouncedUpdate = debounce(() => {
      const newParams = {
        yearRevenue: parseFloat(qs('#pe-yearRevenue').value) || p.yearRevenue,
        yearOrders: parseFloat(qs('#pe-yearOrders').value) || p.yearOrders,
        targetAvgCheck: parseFloat(qs('#pe-targetAvgCheck').value) || p.targetAvgCheck,
        targetConversion: (parseFloat(qs('#pe-targetConversion').value) || 52.9) / 100,
        withdrawalCap: parseFloat(qs('#pe-withdrawalCap').value) || p.withdrawalCap,
        growthPct: parseFloat(qs('#pe-growthPct').value) || p.growthPct,
        seasonal: MONTHS_RU.map((_, i) => parseFloat(qs(`#pe-seasonal-${i}`).value) || 1)
      }
      try { localStorage.setItem('daraclean_plan_params', JSON.stringify(newParams)) } catch (_) {}
      if (onUpdate) onUpdate(newParams)
    }, 500)

    host.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', debouncedUpdate))
  }

  // ─── ГЛАВНАЯ ФУНКЦИЯ РЕНДЕРИНГА ──────────────────────────────────────────
  const renderAll = (rawData, result, funnelResult, filters, handlers) => {
    if (!funnelResult) return

    renderFunnelSVG(funnelResult.funnel6, handlers)
    renderKPIStrip(funnelResult.kpiCards)
    renderManagersTable(funnelResult.managerExtended)
    renderChannelsTable(funnelResult.channelTable)
    renderNewRepeatChart(funnelResult.newVsRepeat)
    renderRejectionChart(funnelResult.rejectionReasons)
    renderProgressTracker(funnelResult.progressTracker)
    renderPlanFactTable(funnelResult.planFactFull)

    // Редактор планирования — рендерим один раз, потом только обновляем при изменении
    const planEditHost = qs('#plan-edit-host')
    if (planEditHost && !planEditHost.dataset.rendered) {
      planEditHost.dataset.rendered = '1'
      renderPlanEditor(funnelResult.planParams, (newParams) => {
        // Перерендер только progress + plan/fact при изменении параметров
        if (global.SalesFunnel && rawData) {
          const updated = global.SalesFunnel.compute(rawData, filters)
          renderProgressTracker(updated.progressTracker)
          renderPlanFactTable(updated.planFactFull)
          renderKPIStrip(updated.kpiCards)
        }
      })
    }
  }

  global.SalesFunnelUI = { renderAll }
})(typeof window !== 'undefined' ? window : globalThis)
