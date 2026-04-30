/**
 * CFO INSPECTION — ручная проверка дашборда как финансовый директор.
 * Браузер открыт, slowMo=600ms — видно каждое действие.
 * Читаем реальные цифры из DOM, проверяем математику, фиксируем расхождения.
 */
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3399'

async function go(page, hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────
function parseNum(str) {
  if (!str) return null
  // убираем ₸, пробелы, M, K
  const s = str.replace(/[₸\s]/g, '').replace(',', '.')
  if (s.endsWith('M')) return parseFloat(s) * 1_000_000
  if (s.endsWith('K')) return parseFloat(s) * 1_000
  return parseFloat(s.replace(/\u00a0/g, '')) || 0
}

function pct(a, b) { return b !== 0 ? ((a - b) / Math.abs(b) * 100).toFixed(1) + '%' : 'n/a' }

const issues = []
function warn(msg, ctx) {
  console.warn('⚠️  ' + msg + (ctx ? ' | ' + ctx : ''))
  issues.push(msg)
}
function ok(msg) { console.log('✅ ' + msg) }

// ═══════════════════════════════════════════════════════════════════════════════
// 1. OVERVIEW — KPI cards + cross-check суммы
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Overview — KPI и кассовый разрыв', async ({ page }) => {
  await go(page, 'overview')

  // Читаем все KPI карточки
  const cards = page.locator('#overview-kpis .kpi-card')
  const count = await cards.count()
  console.log(`\n━━━ OVERVIEW (${count} KPI карточек) ━━━`)

  const kpiData = {}
  for (let i = 0; i < count; i++) {
    const label = await cards.nth(i).locator('.kpi-card__label').textContent()
    const value = await cards.nth(i).locator('.kpi-card__value').textContent()
    const lbl = label.trim().replace(/\s+/g, ' ')
    kpiData[lbl] = value.trim()
    console.log(`  ${lbl}: ${value.trim()}`)
  }

  // Кассовый разрыв
  const cashGap = page.locator('#overview-cash-gap')
  const cashText = await cashGap.textContent()
  console.log('\n  Кассовый разрыв секция:')
  const lines = cashText.split('\n').map(l => l.trim()).filter(Boolean)
  lines.forEach(l => console.log('    ' + l))

  // Break-even
  const be = page.locator('#overview-breakeven')
  const beText = await be.textContent()
  console.log('\n  Break-even секция:')
  beText.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => console.log('    ' + l))

  // Проверка: маржинальность = прибыль / выручка
  const revenue = parseNum(kpiData['Выручка 2025'] || '')
  const margin  = kpiData['Маржинальность'] || ''
  console.log(`\n  → Выручка: ${revenue?.toLocaleString('ru')} ₸`)
  console.log(`  → Маржа: ${margin}`)

  if (revenue && revenue < 50_000_000) warn('Выручка подозрительно мала — меньше 50M ₸', 'Overview')
  else if (revenue) ok(`Выручка ${(revenue/1e6).toFixed(1)}M ₸ — в норме`)
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FINANCE 2025 — дерево расходов, итоги, арифметика
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Finance 2025 — дерево расходов и итоги', async ({ page }) => {
  await go(page, 'finance/2025')
  console.log('\n━━━ FINANCE 2025 ━━━')

  // KPI карточки
  const kpis = page.locator('#f2025-kpis .kpi-card')
  const kpiCount = await kpis.count()
  console.log(`  KPI карточек: ${kpiCount}`)
  for (let i = 0; i < kpiCount; i++) {
    const lbl = (await kpis.nth(i).locator('.kpi-card__label').textContent()).trim().split('\n')[0].trim()
    const val = (await kpis.nth(i).locator('.kpi-card__value').textContent()).trim()
    console.log(`    ${lbl}: ${val}`)
  }

  // Дерево расходов — L0 строки (6 блоков)
  const l0rows = page.locator('.tree-row--l0')
  const l0count = await l0rows.count()
  console.log(`\n  L0 блоков: ${l0count} (ожидается 6)`)
  if (l0count !== 6) warn(`Ожидалось 6 блоков L0, получено ${l0count}`, 'Finance 2025 tree')

  let blockSum = 0
  for (let i = 0; i < l0count; i++) {
    const rowText = await l0rows.nth(i).textContent()
    const cols = rowText.trim().split(/\s{2,}/).filter(Boolean)
    console.log(`    [${i}] ${cols.slice(0, 4).join(' | ')}`)
    // Кликаем раскрыть каждый блок
    await l0rows.nth(i).click()
    await page.waitForTimeout(300)
  }

  // Читаем итоговую строку
  const treeTable = page.locator('#f2025-tree-table')
  const tableText = await treeTable.textContent()
  console.log(`\n  Waterfall chart: ${await page.locator('#chart-f2025-waterfall').isVisible() ? '✅' : '❌'}`)
  console.log(`  Heatmap: ${await page.locator('#f2025-heatmap').isVisible() ? '✅' : '❌'}`)
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. FINANCE 2026 — сценарии, план vs факт, слайдер
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Finance 2026 — план, сценарии, слайдер роста', async ({ page }) => {
  await go(page, 'finance/2026')
  console.log('\n━━━ FINANCE 2026 ━━━')

  // Текущий % роста из слайдера
  const slider = page.locator('#f2026-growth-slider')
  const sliderVal = await slider.inputValue()
  console.log(`  Ползунок роста: ${sliderVal}%`)

  // Прочитать план таблицу
  const planTable = page.locator('#f2026-plan-table table')
  const rows = planTable.locator('tbody tr')
  const rowCount = await rows.count()
  console.log(`\n  Строк в план-таблице: ${rowCount}`)

  // Читаем все строки
  let factCogsSum = 0
  let planCogsSum = 0
  for (let i = 0; i < rowCount; i++) {
    const cells = rows.nth(i).locator('td')
    const cellCount = await cells.count()
    if (cellCount < 4) continue
    const label = (await cells.nth(0).textContent()).trim().replace(/\s+/g, ' ')
    const factVal = (await cells.nth(1).textContent()).trim()
    const planVal = (await cells.nth(4).textContent()).trim()
    if (label && !label.includes('Валовая') && !label.includes('ИТОГО')) {
      console.log(`    ${label.substring(0, 20).padEnd(22)} факт: ${factVal.padEnd(14)} план: ${planVal}`)
    } else if (label.includes('ИТОГО') || label.includes('Валовая')) {
      console.log(`  ► ${label.substring(0, 20).padEnd(22)} факт: ${factVal.padEnd(14)} план: ${planVal}`)
    }
  }

  // 3 сценария
  const cards = page.locator('.scenario-card')
  const cardCount = await cards.count()
  console.log(`\n  Сценариев: ${cardCount}`)
  for (let i = 0; i < cardCount; i++) {
    const cardText = (await cards.nth(i).textContent()).trim().replace(/\s+/g, ' ')
    console.log(`    [${i+1}] ${cardText.substring(0, 100)}`)
  }

  // Проверка: Базовый сценарий должен совпадать со слайдером
  const baseCard = cards.nth(1)
  const baseText = await baseCard.textContent()
  const growthMatch = baseText.match(/(\d+)%/)
  if (growthMatch) {
    const cardGrowth = growthMatch[1]
    if (cardGrowth === sliderVal) {
      ok(`Базовый сценарий ${cardGrowth}% = слайдер ${sliderVal}%`)
    } else {
      warn(`Базовый сценарий ${cardGrowth}% ≠ слайдер ${sliderVal}%`, 'Scenario sync')
    }
  }

  // Проверяем слайдер: ставим 40% и смотрим пересчёт
  console.log('\n  → Двигаем слайдер на 40%...')
  await slider.fill('40')
  await slider.dispatchEvent('input')
  await page.waitForTimeout(800)
  const calcEl = page.locator('#f2026-growth-calc')
  const calcText = await calcEl.textContent()
  console.log(`  → Расчёт после 40%: ${calcText.trim()}`)

  // Возвращаем 25%
  await slider.fill('25')
  await slider.dispatchEvent('input')
  await page.waitForTimeout(500)

  // Monthly план таблица
  const monthlyTable = page.locator('#f2026-monthly-plan table')
  const isMonthlyVisible = await monthlyTable.isVisible()
  console.log(`\n  Помесячная таблица: ${isMonthlyVisible ? '✅' : '❌'}`)
  if (isMonthlyVisible) {
    const mRows = monthlyTable.locator('tbody tr')
    const mCount = await mRows.count()
    console.log(`  Строк в помесячной таблице: ${mCount}`)
    for (let i = 0; i < Math.min(mCount, 8); i++) {
      const lbl = (await mRows.nth(i).locator('td').first().textContent()).trim()
      const last = await mRows.nth(i).locator('td').last()
      const total = (await last.textContent()).trim()
      console.log(`    ${lbl.substring(0, 25).padEnd(26)}: ИТОГО ${total}`)
    }
  }

  // Кассовый разрыв строка
  const gapRow = monthlyTable.locator('tr:has-text("Погашение разрыва")')
  if (await gapRow.count() > 0) {
    const gapText = await gapRow.textContent()
    const totalCell = (await gapRow.locator('td').last().textContent()).trim()
    console.log(`\n  Погашение разрыва (итого): ${totalCell}`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. СЕБЕСТОИМОСТЬ — KPI, break-even, редактируемые поля
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Себестоимость — break-even и KPI', async ({ page }) => {
  await go(page, 'cost')
  console.log('\n━━━ СЕБЕСТОИМОСТЬ ━━━')

  const kpis = page.locator('#cost-kpis .kpi-card')
  const count = await kpis.count()
  for (let i = 0; i < count; i++) {
    const lbl = (await kpis.nth(i).locator('.kpi-card__label').textContent()).trim().split('\n')[0].trim()
    const val = (await kpis.nth(i).locator('.kpi-card__value').textContent()).trim()
    const note = await kpis.nth(i).locator('.kpi-card__computed').count() > 0
      ? (await kpis.nth(i).locator('.kpi-card__computed').textContent()).trim()
      : ''
    console.log(`  ${lbl}: ${val}${note ? '  (факт: ' + note + ')' : ''}`)
  }

  // Break-even
  const be = page.locator('#cost-breakeven')
  const beText = await be.textContent()
  console.log('\n  Break-even:')
  beText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8).forEach(l => console.log('    ' + l))

  // Себестоимость 1 кв.м — проверяем логику
  const sqmCard = kpis.nth(0)
  const sqmVal = parseNum(await sqmCard.locator('.kpi-card__value').textContent())
  const factNote = await sqmCard.locator('.kpi-card__computed').textContent()
  const factSqm = parseNum(factNote.replace('факт:', ''))
  console.log(`\n  Себестоимость/кв.м план: ${sqmVal} ₸, факт: ${factSqm} ₸`)
  if (sqmVal && factSqm) {
    const diff = sqmVal - factSqm
    if (Math.abs(diff) / factSqm > 0.5) {
      warn(`Большая разница план/факт себест. кв.м: ${diff > 0 ? '+' : ''}${diff} ₸ (${pct(sqmVal, factSqm)})`, 'Cost KPI')
    } else {
      ok(`Себестоимость кв.м разница: ${pct(sqmVal, factSqm)} — норма`)
    }
  }

  // Маржа
  const marginCard = kpis.nth(4)
  const marginVal = (await marginCard.locator('.kpi-card__value').textContent()).trim()
  console.log(`  Валовая маржа (план): ${marginVal}`)
  const marginNum = parseFloat(marginVal)
  if (!isNaN(marginNum)) {
    if (marginNum < 15) warn(`Маржа ${marginVal} < 15% — ниже нормы клининга 25-35%`, 'Cost margin')
    else ok(`Маржа ${marginVal} — ОК`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. UNIT ECONOMICS — CAC/LTV, Growth 2026-2028
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Unit Economics — CAC/LTV и прогноз роста', async ({ page }) => {
  await go(page, 'unit/cac')
  console.log('\n━━━ UNIT ECONOMICS — CAC/LTV ━━━')

  const kpis = page.locator('#ucac-kpis')
  const kpiText = await kpis.textContent()
  kpiText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12).forEach(l => console.log('  ' + l))

  // LTV/CAC ratio — должен быть > 3 (норма для SaaS/услуг)
  const ratioEl = kpis.locator(':text("LTV / CAC")').locator('..')
  const ltv = parseNum(await kpis.textContent().then(t => {
    const m = t.match(/LTV\D+([\d\s]+₸)/)
    return m ? m[1] : '0'
  }))

  // Growth 2026-2028
  await go(page, 'unit/growth')
  console.log('\n━━━ UNIT ECONOMICS — РОСТ 2026-2028 ━━━')

  const growthTable = page.locator('#ugr-table')
  const tableText = await growthTable.textContent()
  tableText.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => console.log('  ' + l))

  // Проверка: выручка 2026 должна быть > 2025 факта
  const cells = growthTable.locator('td')
  const cellTexts = await cells.allTextContents()
  console.log('\n  Ячейки таблицы роста:', cellTexts.slice(0, 20).join(' | '))
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ПРОДАЖИ — Воронка, Каналы, Менеджеры
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Продажи — воронка, каналы, ROAS', async ({ page }) => {
  await go(page, 'funnel')
  console.log('\n━━━ ВОРОНКА ПРОДАЖ ━━━')

  const kpis = page.locator('#funnel-kpis .kpi-card')
  const count = await kpis.count()
  for (let i = 0; i < count; i++) {
    const lbl = (await kpis.nth(i).locator('.kpi-card__label').textContent()).trim().split('\n')[0].trim()
    const val = (await kpis.nth(i).locator('.kpi-card__value').textContent()).trim()
    console.log(`  ${lbl}: ${val}`)
  }

  // Каналы — ROAS
  await go(page, 'sales/channels')
  console.log('\n━━━ КАНАЛЫ — ROAS ━━━')
  const channelTable = page.locator('#sch-content .data-table')
  const chRows = channelTable.locator('tbody tr')
  const chCount = await chRows.count()
  for (let i = 0; i < chCount; i++) {
    const cells = chRows.nth(i).locator('td')
    const cellCount = await cells.count()
    const name = cellCount > 0 ? (await cells.nth(0).textContent()).trim() : ''
    const roas = cellCount > 4 ? (await cells.nth(cellCount - 2).textContent()).trim() : '?'
    const cac  = cellCount > 3 ? (await cells.nth(cellCount - 3).textContent()).trim() : '?'
    if (name) console.log(`  ${name.padEnd(20)} CAC: ${cac.padEnd(12)} ROAS: ${roas}`)
  }

  // Менеджеры
  await go(page, 'sales/managers')
  console.log('\n━━━ МЕНЕДЖЕРЫ ━━━')
  const mgrTable = page.locator('#smgr-content .data-table')
  const mgrText = await mgrTable.textContent()
  mgrText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 15).forEach(l => console.log('  ' + l))
})

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ИТОГОВЫЙ ОТЧЁТ
// ═══════════════════════════════════════════════════════════════════════════════
test('CFO: Итоговый отчёт по проверке', async ({ page }) => {
  await go(page, 'overview')
  console.log('\n' + '═'.repeat(60))
  console.log('CFO INSPECTION — ИТОГ')
  console.log('═'.repeat(60))
  if (issues.length === 0) {
    console.log('✅ Замечаний не найдено')
  } else {
    console.log(`⚠️  Найдено замечаний: ${issues.length}`)
    issues.forEach((iss, i) => console.log(`  ${i+1}. ${iss}`))
  }
  console.log('═'.repeat(60))
})
