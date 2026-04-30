;(function (global) {
  'use strict'

  const ROUTES = {
    '#overview':           { pageId: 'page-overview',         breadcrumb: ['Обзор'] },
    '#finance/2025':       { pageId: 'page-finance-2025',     breadcrumb: ['Финансы', '2025 — Факт'] },
    '#finance/2026':       { pageId: 'page-finance-2026',     breadcrumb: ['Финансы', '2026 — План'] },
    '#finance/calendar':   { pageId: 'page-finance-calendar', breadcrumb: ['Финансы', 'Календарь'] },
    '#cost':               { pageId: 'page-cost',             breadcrumb: ['Себестоимость'] },
    '#funnel':             { pageId: 'page-funnel',           breadcrumb: ['Воронка'] },
    '#sales/managers':     { pageId: 'page-sales-managers',   breadcrumb: ['Продажи', 'Менеджеры'] },
    '#sales/channels':     { pageId: 'page-sales-channels',   breadcrumb: ['Продажи', 'Каналы'] },
    '#sales/clients':      { pageId: 'page-sales-clients',    breadcrumb: ['Продажи', 'Клиенты'] },
    '#sales/plan':         { pageId: 'page-sales-plan',       breadcrumb: ['Продажи', 'План'] },
    '#unit/cac':           { pageId: 'page-unit-cac',         breadcrumb: ['Unit-экономика', 'CAC / LTV'] },
    '#unit/marketing':     { pageId: 'page-unit-marketing',   breadcrumb: ['Unit-экономика', 'Маркетинг'] },
    '#unit/growth':        { pageId: 'page-unit-growth',      breadcrumb: ['Unit-экономика', '2026–2028'] },
    '#goals':              { pageId: 'page-goals',            breadcrumb: ['Цели'] },
    '#heatmap':            { pageId: 'page-heatmap',          breadcrumb: ['Тепловая карта'] },
    '#legacy':             { pageId: 'page-legacy',           breadcrumb: ['Старый дашборд'] },
  }

  // Обработчики render для каждого маршрута (регистрируются модулями)
  const handlers = {}

  let currentHash = null

  function navigate(hash) {
    if (!hash || hash === '#') hash = '#overview'
    if (!ROUTES[hash]) hash = '#overview'
    if (hash === currentHash) return
    currentHash = hash

    const route = ROUTES[hash]

    // Скрыть все страницы
    document.querySelectorAll('.page').forEach(el => {
      el.classList.remove('page--active')
    })

    // Показать нужную
    const page = document.getElementById(route.pageId)
    if (page) page.classList.add('page--active')

    // Обновить sidebar active state
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.remove('nav-item--active')
    })
    const activeLink = document.querySelector(`.nav-item[data-route="${hash}"]`)
    if (activeLink) {
      activeLink.classList.add('nav-item--active')
      // Открыть родительскую группу если нужно
      const group = activeLink.closest('.nav-group')
      if (group && !group.classList.contains('open')) {
        group.classList.add('open')
      }
    }

    // Обновить breadcrumb
    const bc = route.breadcrumb
    const bcEl = document.getElementById('breadcrumb')
    if (bcEl) {
      if (bc.length === 1) {
        bcEl.innerHTML = `<span class="topbar__breadcrumb-current">${bc[0]}</span>`
      } else {
        const parts = bc.slice(0, -1).map(p => `<span>${p}</span><span class="topbar__breadcrumb-sep">›</span>`).join('')
        bcEl.innerHTML = `${parts}<span class="topbar__breadcrumb-current">${bc[bc.length - 1]}</span>`
      }
    }

    // Вызвать обработчик если зарегистрирован
    if (handlers[hash]) {
      try { handlers[hash]() } catch (e) { console.error('Router handler error:', hash, e) }
    }
  }

  function onHashChange() {
    navigate(location.hash)
  }

  /** Force re-render текущей страницы (при смене фильтра периода) */
  function refresh() {
    const hash = currentHash
    currentHash = null
    navigate(hash || location.hash || '#overview')
  }

  function init() {
    window.addEventListener('hashchange', onHashChange)

    // Переключатель периода → перерисовать текущую страницу
    const periodSel = document.getElementById('sel-period')
    if (periodSel) {
      periodSel.addEventListener('change', () => refresh())
    }

    // Nav item клики
    document.querySelectorAll('.nav-item[data-route]').forEach(el => {
      el.addEventListener('click', () => {
        location.hash = el.dataset.route
      })
    })
    // Группы toggle
    document.querySelectorAll('.nav-group__toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const group = toggle.closest('.nav-group')
        group.classList.toggle('open')
      })
    })
    // Начальная навигация
    navigate(location.hash || '#overview')
  }

  /**
   * Зарегистрировать обработчик для маршрута.
   * Вызывается при каждом переходе на этот маршрут.
   * @param {string} hash
   * @param {Function} fn
   */
  function on(hash, fn) {
    handlers[hash] = fn
  }

  global.Router = { init, on, navigate, refresh }
})(window)
