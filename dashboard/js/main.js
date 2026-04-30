;(function () {
  'use strict'

  // ============================================================
  // Форматирование чисел
  // ============================================================

  const fmtMoney = (n) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' ₸'

  const fmtNum = (n) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0)

  const fmtPct = (n, dec) =>
    (n || 0).toFixed(dec != null ? dec : 1) + '%'

  window.DC = window.DC || {}
  window.DC.fmt = { money: fmtMoney, num: fmtNum, pct: fmtPct }

  // ============================================================
  // Загрузка данных
  // ============================================================

  async function loadJSON(url) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return await res.json()
    } catch (e) {
      return null
    }
  }

  async function init() {
    // Загружаем оба JSON параллельно
    const [dashData, finData] = await Promise.all([
      loadJSON('data/dashboard-data.json'),
      loadJSON('data/finance-full-data.json')
    ])

    window.DashboardData = dashData
    window.FinanceFullData = finData

    // Регистрируем обработчики роутера
    if (window.FinanceDashboard) {
      Router.on('#overview', () => window.FinanceDashboard.renderOverview())
      Router.on('#finance/2025', () => window.FinanceDashboard.renderFinance2025())
      Router.on('#finance/2026', () => window.FinanceDashboard.renderFinance2026())
      Router.on('#finance/calendar', () => window.FinanceDashboard.renderCalendar())
      Router.on('#cost', () => window.FinanceDashboard.renderCost())
    }

    if (window.SalesDashboard) {
      Router.on('#funnel', () => window.SalesDashboard.renderFunnel())
      Router.on('#sales/managers', () => window.SalesDashboard.renderManagers())
      Router.on('#sales/channels', () => window.SalesDashboard.renderChannels())
      Router.on('#sales/clients', () => window.SalesDashboard.renderClients())
      Router.on('#sales/plan', () => window.SalesDashboard.renderPlan())
    }

    if (window.UnitEconomics) {
      Router.on('#unit/cac', () => window.UnitEconomics.renderCAC())
      Router.on('#unit/marketing', () => window.UnitEconomics.renderMarketing())
      Router.on('#unit/growth', () => window.UnitEconomics.renderGrowth())
    }

    // Тепловая карта
    if (window.HeatmapDashboard) {
      Router.on('#heatmap', () => window.HeatmapDashboard.render())
    }

    // OKR / goals — базовая заглушка
    Router.on('#goals', renderGoals)

    // Legacy — показываем ссылку на обзор
    Router.on('#legacy', () => {
      const inner = document.getElementById('legacy-inner')
      if (inner && !inner.dataset.rendered) {
        inner.dataset.rendered = '1'
        inner.innerHTML = `
          <div style="padding:32px;max-width:600px">
            <h2 style="font-size:18px;font-weight:700;margin-bottom:12px">Устаревший дашборд</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px">
              Старый дашборд заменён новым финансовым модулем.
              Все данные доступны в разделах «Обзор», «Финансы» и «Себестоимость».
            </p>
            <a href="#overview" style="padding:8px 18px;background:var(--accent);color:#fff;border-radius:8px;font-size:14px;text-decoration:none">
              → Перейти к Обзору
            </a>
          </div>`
      }
    })

    // Инициализация роутера (запускает навигацию по текущему hash)
    Router.init()

    // Экспорт планов
    document.getElementById('btn-export-plans').addEventListener('click', exportPlans)
  }

  // ============================================================
  // Goals (OKR) — базовый рендер
  // ============================================================

  function renderGoals() {
    const content = document.getElementById('goals-content')
    const loading = document.getElementById('goals-loading')

    const STORAGE_KEY = 'dc-goals'
    const defaults = [
      { id: 'revenue', goal: 'Выручка 2026', target: 126000000, current: 23200000, deadline: '2026-12-31', unit: '₸' },
      { id: 'margin', goal: 'Маржинальность', target: 15, current: 4.2, deadline: '2026-12-31', unit: '%' },
      { id: 'orders', goal: 'Заказов в год', target: 4800, current: 340, deadline: '2026-12-31', unit: 'шт' },
      { id: 'avg_check', goal: 'Средний чек', target: 28000, current: 24612, deadline: '2026-12-31', unit: '₸' },
      { id: 'cac', goal: 'Снизить CAC', target: 3000, current: 3531, baseline: 6998, inverse: true, deadline: '2026-12-31', unit: '₸' },
      { id: 'cash_gap', goal: 'Закрыть кассовый разрыв', target: 0, current: -5431123, baseline: -5431123, inverse: true, deadline: '2026-12-31', unit: '₸' },
    ]

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const rows = defaults.map(d => ({ ...d, ...(saved[d.id] || {}) }))

    const fmt = window.DC.fmt

    const table = document.getElementById('goals-table')
    table.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Цель</th>
            <th class="num">Целевое значение</th>
            <th class="num">Текущее</th>
            <th>Прогресс</th>
            <th>Дедлайн</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            let pct
            if (r.inverse) {
              const range = r.baseline - r.target
              pct = range === 0
                ? (r.current <= r.target ? 100 : 0)
                : Math.min(100, Math.max(0, (r.baseline - r.current) / range * 100))
            } else {
              pct = r.target !== 0
                ? Math.min(100, Math.max(0, (r.current / r.target) * 100))
                : 100
            }
            const color = pct >= 80 ? 'good' : pct >= 50 ? '' : 'bad'
            const barClass = pct >= 80 ? 'good' : pct >= 50 ? '' : 'bad'
            const valFmt = r.unit === '₸' ? fmt.money : r.unit === '%' ? v => fmt.pct(v) : v => fmt.num(v) + ' ' + r.unit
            return `<tr>
              <td>${r.goal}</td>
              <td class="num">${valFmt(r.target)}</td>
              <td class="num">${valFmt(r.current)}</td>
              <td style="min-width:160px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="progress-bar" style="flex:1">
                    <div class="progress-bar__fill progress-bar__fill--${barClass}" style="width:${pct.toFixed(1)}%"></div>
                  </div>
                  <span style="font-size:12px;font-weight:600;min-width:36px;text-align:right">${pct.toFixed(0)}%</span>
                </div>
              </td>
              <td>${r.deadline}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    `

    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'
  }

  // ============================================================
  // Экспорт всех планов из localStorage
  // ============================================================

  function exportPlans() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('dc-'))
    const data = {}
    keys.forEach(k => {
      try { data[k] = JSON.parse(localStorage.getItem(k)) } catch (e) { data[k] = localStorage.getItem(k) }
    })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daraclean-plans-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ============================================================
  // Start
  // ============================================================

  document.addEventListener('DOMContentLoaded', init)

})()
