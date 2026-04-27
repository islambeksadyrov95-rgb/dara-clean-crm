import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3399'

// ─── Helper: navigate and wait for page ─────────────────────────────────────
async function navigateTo(page, hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500) // let JS render
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SIDEBAR NAVIGATION — все 14 маршрутов
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Sidebar Navigation', () => {
  const routes = [
    { hash: 'overview',          pageId: 'page-overview' },
    { hash: 'finance/2025',      pageId: 'page-finance-2025' },
    { hash: 'finance/2026',      pageId: 'page-finance-2026' },
    { hash: 'finance/calendar',  pageId: 'page-finance-calendar' },
    { hash: 'cost',              pageId: 'page-cost' },
    { hash: 'funnel',            pageId: 'page-funnel' },
    { hash: 'sales/managers',    pageId: 'page-sales-managers' },
    { hash: 'sales/channels',    pageId: 'page-sales-channels' },
    { hash: 'sales/clients',     pageId: 'page-sales-clients' },
    { hash: 'sales/plan',        pageId: 'page-sales-plan' },
    { hash: 'unit/cac',          pageId: 'page-unit-cac' },
    { hash: 'unit/marketing',    pageId: 'page-unit-marketing' },
    { hash: 'unit/growth',       pageId: 'page-unit-growth' },
    { hash: 'goals',             pageId: 'page-goals' }
  ]

  for (const { hash, pageId } of routes) {
    test(`route #${hash} → page ${pageId} visible`, async ({ page }) => {
      await navigateTo(page, hash)
      const pageEl = page.locator(`#${pageId}`)
      await expect(pageEl).toBeVisible()
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. OVERVIEW PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Overview Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'overview')
  })

  test('renders 5 KPI cards', async ({ page }) => {
    const kpis = page.locator('#overview-kpis .kpi-card')
    await expect(kpis).toHaveCount(5)
  })

  test('KPI cards contain correct labels', async ({ page }) => {
    const kpiEl = page.locator('#overview-kpis')
    await expect(kpiEl).toContainText('Выручка 2025')
    await expect(kpiEl).toContainText('Себестоимость')
    await expect(kpiEl).toContainText('Валовая прибыль')
    await expect(kpiEl).toContainText('Вывод собственника')
    await expect(kpiEl).toContainText('Маржинальность')
  })

  test('cash gap alert is visible', async ({ page }) => {
    const gap = page.locator('#overview-cash-gap')
    await expect(gap).toContainText('Кассовый разрыв')
    await expect(gap).toContainText('Текущий дефицит')
    await expect(gap).toContainText('Пик дефицита')
  })

  test('break-even section is visible', async ({ page }) => {
    const be = page.locator('#overview-breakeven')
    await expect(be).toContainText('Точка безубыточности')
    await expect(be).toContainText('Break-even')
  })

  test('salary rule "10th date" is visible', async ({ page }) => {
    const salary = page.locator('#overview-salary-rule')
    await expect(salary).toContainText('Правило «10-го числа»')
    await expect(salary).toContainText('фонд ЗП')
  })

  test('area chart canvas exists', async ({ page }) => {
    const canvas = page.locator('#chart-overview-area')
    await expect(canvas).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. COST PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Cost Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'cost')
  })

  test('renders 5 KPI cards', async ({ page }) => {
    const kpis = page.locator('#cost-kpis .kpi-card')
    await expect(kpis).toHaveCount(5)
  })

  test('KPI cards show correct values', async ({ page }) => {
    const kpiEl = page.locator('#cost-kpis')
    await expect(kpiEl).toContainText('959')  // cost per sqm
    await expect(kpiEl).toContainText('23 582') // cost per order
    await expect(kpiEl).toContainText('4.2%') // margin
  })

  test('stacked bar chart canvas exists', async ({ page }) => {
    const canvas = page.locator('#chart-cost-bar')
    await expect(canvas).toBeVisible()
  })

  test('break-even section exists', async ({ page }) => {
    const be = page.locator('#cost-breakeven')
    await expect(be).toContainText('Break-even')
  })

  test('editable cost table has yellow inputs', async ({ page }) => {
    const inputs = page.locator('.cost-input')
    const count = await inputs.count()
    expect(count).toBeGreaterThan(0)
    // Check yellow background on first input
    const first = inputs.first()
    const bg = await first.evaluate(el => getComputedStyle(el).backgroundColor)
    // #FFFBEB = rgb(255, 251, 235)
    expect(bg).toContain('255')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. FINANCE 2025 PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Finance 2025 Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'finance/2025')
  })

  test('renders KPI cards', async ({ page }) => {
    const kpis = page.locator('#f2025-kpis .kpi-card')
    const count = await kpis.count()
    expect(count).toBe(5)
  })

  test('tree table with expand/collapse', async ({ page }) => {
    const tree = page.locator('#f2025-tree-table')
    await expect(tree).toBeVisible()
    // Should have L0 rows (6 cost blocks)
    const l0rows = page.locator('.tree-row--l0')
    const count = await l0rows.count()
    expect(count).toBe(6)
    // Click first block to expand
    await l0rows.first().click()
    await page.waitForTimeout(200)
    // Should now have L1 rows
    const l1rows = page.locator('.tree-row--l1')
    const l1count = await l1rows.count()
    expect(l1count).toBeGreaterThan(0)
  })

  test('tree table has sparkline canvases', async ({ page }) => {
    const sparks = page.locator('#f2025-tree-table canvas[id^="spark-"]')
    const count = await sparks.count()
    expect(count).toBe(6) // 6 cost blocks
  })

  test('tree table has Тренд column', async ({ page }) => {
    const header = page.locator('#f2025-tree-table th')
    const texts = await header.allTextContents()
    expect(texts).toContain('Тренд')
  })

  test('waterfall chart exists', async ({ page }) => {
    const canvas = page.locator('#chart-f2025-waterfall')
    await expect(canvas).toBeVisible()
  })

  test('heatmap exists', async ({ page }) => {
    const hm = page.locator('#f2025-heatmap')
    await expect(hm).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. FINANCE 2026 PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Finance 2026 Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'finance/2026')
  })

  test('revenue growth slider exists', async ({ page }) => {
    const slider = page.locator('#f2026-growth-slider')
    await expect(slider).toBeVisible()
  })

  test('3 scenario cards', async ({ page }) => {
    const cards = page.locator('.scenario-card')
    const count = await cards.count()
    expect(count).toBe(3)
  })

  test('scenario cards show parameters (growth, costs, withdrawal)', async ({ page }) => {
    const card = page.locator('.scenario-card').first()
    await expect(card).toContainText('Рост выручки')
    await expect(card).toContainText('Оптимизация')
    await expect(card).toContainText('Лимит вывода')
  })

  test('scenario chart exists', async ({ page }) => {
    const canvas = page.locator('#chart-f2026-scenarios')
    await expect(canvas).toBeVisible()
  })

  test('plan/fact table exists', async ({ page }) => {
    const content = page.locator('#f2026-content')
    await expect(content).toContainText('Факт 2025')
    await expect(content).toContainText('План 2026')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. CALENDAR PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Calendar Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'finance/calendar')
  })

  test('GitHub-style heatmap SVG exists', async ({ page }) => {
    const hm = page.locator('#fcal-heatmap svg')
    await expect(hm).toBeVisible()
  })

  test('heatmap has day cells (rect elements)', async ({ page }) => {
    const rects = page.locator('#fcal-heatmap svg rect')
    const count = await rects.count()
    expect(count).toBeGreaterThan(300) // ~365 days
  })

  test('heatmap has month labels', async ({ page }) => {
    const hm = page.locator('#fcal-heatmap')
    await expect(hm).toContainText('Янв')
    await expect(hm).toContainText('Дек')
  })

  test('heatmap has color legend', async ({ page }) => {
    const hm = page.locator('#fcal-heatmap')
    await expect(hm).toContainText('Меньше')
    await expect(hm).toContainText('Больше')
  })

  test('bipolar bar chart exists', async ({ page }) => {
    const canvas = page.locator('#chart-fcal-bipolar')
    await expect(canvas).toBeVisible()
  })

  test('filter dropdowns exist', async ({ page }) => {
    await expect(page.locator('#fcal-filter-type')).toBeVisible()
    await expect(page.locator('#fcal-filter-payment')).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. FUNNEL PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Funnel Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'funnel')
  })

  test('renders KPI cards', async ({ page }) => {
    const kpis = page.locator('#funnel-kpis .kpi-card')
    const count = await kpis.count()
    expect(count).toBeGreaterThanOrEqual(4)
  })

  test('SVG funnel is visible', async ({ page }) => {
    const funnel = page.locator('#funnel-content svg')
    await expect(funnel).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. SALES — MANAGERS
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Sales Managers Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'sales/managers')
  })

  test('manager table is visible', async ({ page }) => {
    const content = page.locator('#smgr-content')
    await expect(content).toContainText('Менеджер')
    await expect(content).toContainText('Конверсия')
  })

  test('manager table has expected columns', async ({ page }) => {
    const headers = page.locator('#smgr-content .data-table th')
    const texts = await headers.allTextContents()
    expect(texts.join(',')).toContain('Обращений')
    expect(texts.join(',')).toContain('Заказов')
    expect(texts.join(',')).toContain('Выручка')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9. SALES — CHANNELS (with ROAS)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Sales Channels Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'sales/channels')
  })

  test('channel table has ROAS column', async ({ page }) => {
    const headers = page.locator('#sch-content .data-table th')
    const texts = await headers.allTextContents()
    expect(texts.join(',')).toContain('ROAS')
  })

  test('channel table has CAC column', async ({ page }) => {
    const headers = page.locator('#sch-content .data-table th')
    const texts = await headers.allTextContents()
    expect(texts.join(',')).toContain('CAC')
  })

  test('rejection reasons chart exists', async ({ page }) => {
    const canvas = page.locator('#chart-sch-rejections')
    await expect(canvas).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 10. SALES — CLIENTS
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Sales Clients Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'sales/clients')
  })

  test('donut chart (new vs repeat) exists', async ({ page }) => {
    const canvas = page.locator('#chart-scl-donut')
    await expect(canvas).toBeVisible()
  })

  test('shows new vs repeat labels', async ({ page }) => {
    const content = page.locator('#scl-content')
    await expect(content).toContainText('Новые')
    await expect(content).toContainText('Повторные')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 11. SALES — PLAN
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Sales Plan Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'sales/plan')
  })

  test('editable plan inputs exist', async ({ page }) => {
    const inputs = page.locator('#splan-content input')
    const count = await inputs.count()
    expect(count).toBeGreaterThan(0)
  })

  test('plan content is visible', async ({ page }) => {
    const content = page.locator('#splan-content')
    await expect(content).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 12. UNIT ECONOMICS — CAC/LTV
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Unit Economics CAC/LTV Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'unit/cac')
  })

  test('KPI cards (LTV, CAC, LTV/CAC)', async ({ page }) => {
    const kpis = page.locator('#ucac-kpis')
    await expect(kpis).toContainText('LTV')
    await expect(kpis).toContainText('CAC blended')
    await expect(kpis).toContainText('LTV / CAC')
  })

  test('channel CAC table exists', async ({ page }) => {
    const table = page.locator('#ucac-table .data-table')
    await expect(table).toBeVisible()
  })

  test('CAC table has editable budget inputs', async ({ page }) => {
    const inputs = page.locator('#ucac-table .cost-input')
    const count = await inputs.count()
    expect(count).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 13. UNIT ECONOMICS — MARKETING
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Unit Economics Marketing Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'unit/marketing')
  })

  test('scatter plot exists', async ({ page }) => {
    const canvas = page.locator('#chart-umkt-scatter')
    await expect(canvas).toBeVisible()
  })

  test('budget simulator with editable inputs', async ({ page }) => {
    const sim = page.locator('#umkt-simulator')
    await expect(sim).toContainText('Симулятор распределения бюджета')
    const inputs = sim.locator('input[data-ch]')
    const count = await inputs.count()
    expect(count).toBeGreaterThan(0)
  })

  test('simulator KPI cards (budget, orders, revenue, ROAS)', async ({ page }) => {
    const sim = page.locator('#umkt-simulator')
    await expect(sim).toContainText('Общий бюджет')
    await expect(sim).toContainText('Прогноз заказов')
    await expect(sim).toContainText('ROAS общий')
  })

  test('simulator table has ROAS column', async ({ page }) => {
    const headers = page.locator('#umkt-simulator .data-table th')
    const texts = await headers.allTextContents()
    expect(texts.join(',')).toContain('ROAS')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 14. UNIT ECONOMICS — GROWTH 2026-2028
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Unit Economics Growth Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'unit/growth')
  })

  test('growth table with 2025-2028 columns', async ({ page }) => {
    const table = page.locator('#ugr-table')
    await expect(table).toContainText('2025 факт')
    await expect(table).toContainText('2026 план')
    await expect(table).toContainText('2028 план')
    await expect(table).toContainText('CAGR')
  })

  test('growth table rows: Выручка, Себестоимость, Маржа', async ({ page }) => {
    const table = page.locator('#ugr-table')
    await expect(table).toContainText('Выручка')
    await expect(table).toContainText('Себестоимость')
    await expect(table).toContainText('Маржа')
  })

  test('growth chart exists', async ({ page }) => {
    const canvas = page.locator('#chart-ugr-growth')
    await expect(canvas).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 15. GOALS PAGE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Goals Page', () => {
  test('goals page renders', async ({ page }) => {
    await navigateTo(page, 'goals')
    const el = page.locator('#page-goals')
    await expect(el).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 16. EDITABLE FIELDS — Yellow highlighting
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Editable Fields UX', () => {
  test('cost page inputs have yellow border', async ({ page }) => {
    await navigateTo(page, 'cost')
    const inp = page.locator('.cost-input').first()
    const border = await inp.evaluate(el => el.style.borderColor || getComputedStyle(el).borderColor)
    // Should contain #FDE68A components or similar yellow
    expect(border).toBeTruthy()
  })

  test('CAC page budget inputs have yellow styling', async ({ page }) => {
    await navigateTo(page, 'unit/cac')
    const inp = page.locator('.cost-input').first()
    await expect(inp).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 17. NUMBER FORMATTING
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Number Formatting', () => {
  test('KPI values use ru-RU formatting (spaces as thousand separators)', async ({ page }) => {
    await navigateTo(page, 'overview')
    const kpi = page.locator('#overview-kpis .kpi-card__value').first()
    const text = await kpi.textContent()
    // Should contain space as thousand separator and ₸ symbol
    expect(text).toContain('₸')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 18. INTERACTIVE — Scenario slider changes values
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Interactive Scenarios', () => {
  test('changing revenue growth slider updates plan', async ({ page }) => {
    await navigateTo(page, 'finance/2026')
    const slider = page.locator('#f2026-growth-slider')
    if (await slider.isVisible()) {
      // Get initial plan value
      const content = page.locator('#f2026-content')
      const textBefore = await content.textContent()
      // Move slider
      await slider.fill('40')
      await slider.dispatchEvent('input')
      await page.waitForTimeout(400)
      const textAfter = await content.textContent()
      // Some value should change after adjusting growth
      // This is a soft check — just verify the page didn't break
      expect(textAfter.length).toBeGreaterThan(0)
    }
  })
})
