/**
 * Тесты целостности данных:
 * - Fix 3: meta.buildTime парсится и форматируется
 * - Fix 1: classifyRow() возвращает 'other' для неизвестных + BLOCK_META/BLOCK_KEYS содержат 'other'
 * - Fix 4: deriveFactsFromDds() извлекает revenue и blockTotals из DDS
 */
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function loadFinanceData() {
  const code = fs.readFileSync(path.join(root, 'js', 'finance-data.js'), 'utf8')
  const ctx = { window: {} }
  vm.runInNewContext(code, ctx)
  return ctx.window.FinanceData
}

function loadCostModel() {
  const code = fs.readFileSync(path.join(root, 'js', 'cost-model.js'), 'utf8')
  const ctx = { window: {} }
  vm.runInNewContext(code, ctx)
  return ctx.window.DaraCostModel
}

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  OK: ${msg}`) }
  else { failed++; console.error(`  FAIL: ${msg}`) }
}

// ─── Fix 3: Timestamp ───────────────────────────────────────────────────────
console.log('\n=== Fix 3: Timestamp синхронизации ===')

const dataPath = path.join(root, 'data', 'dashboard-data.json')
const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

assert(raw.meta && typeof raw.meta.buildTime === 'string', 'meta.buildTime exists in JSON')

const d = new Date(raw.meta.buildTime)
assert(!isNaN(d.getTime()), 'meta.buildTime is valid ISO date')

const dd = String(d.getDate()).padStart(2, '0')
const mm = String(d.getMonth() + 1).padStart(2, '0')
const hh = String(d.getHours()).padStart(2, '0')
const min = String(d.getMinutes()).padStart(2, '0')
const formatted = `Данные от ${dd}.${mm}.${d.getFullYear()} ${hh}:${min}`
assert(formatted.length > 15, 'timestamp formats correctly: ' + formatted)

// ─── Fix 1: classifyRow fallback → 'other' ─────────────────────────────────
console.log('\n=== Fix 1: Fallback-блок other ===')

const FD = loadFinanceData()

assert(FD.BLOCK_KEYS.includes('other'), 'BLOCK_KEYS contains "other"')
assert(FD.BLOCK_META.other != null, 'BLOCK_META has "other" entry')
assert(FD.BLOCK_META.other && FD.BLOCK_META.other.label === 'Прочее', 'BLOCK_META.other.label = "Прочее"')

// Известные строки маппятся правильно
assert(FD.classifyRow('ФОТ оклад ЦЕХ') === 'production', 'known row → production')
assert(FD.classifyRow('ГСМ') === 'logistics', 'known row → logistics')
assert(FD.classifyRow('Покупка рекламы Google') === 'marketing', 'known row → marketing')

// Substring fallback работает
assert(FD.classifyRow('ФОТ новая строка') === 'production', 'substring ФОТ → production')
assert(FD.classifyRow('Налог на имущество') === 'taxes', 'substring налог → taxes')

// Неизвестная строка → 'other', не 'overhead'
assert(FD.classifyRow('Совершенно новая статья XYZ') === 'other', 'unknown row → other (not overhead)')
assert(FD.classifyRow('Какая-то неизвестная строка') === 'other', 'another unknown → other')

// ─── Fix 4: deriveFactsFromDds ──────────────────────────────────────────────
console.log('\n=== Fix 4: deriveFactsFromDds ===')

assert(typeof FD.deriveFactsFromDds === 'function', 'deriveFactsFromDds exported')

// Тест с реальными DDS данными из JSON
if (typeof FD.deriveFactsFromDds === 'function' && raw.dds && raw.dds.length > 0) {
  const derived = FD.deriveFactsFromDds(raw.dds, 2025)
  if (derived) {
    assert(derived.revenue > 0, 'derived revenue > 0: ' + derived.revenue)
    assert(derived.totalCogs > 0, 'derived totalCogs > 0: ' + derived.totalCogs)
    assert(typeof derived.blockTotals === 'object', 'blockTotals is object')
    assert(derived.year === 2025, 'derived year = 2025')

    // Revenue должна быть в разумном диапазоне (±20% от хардкода 113M)
    const hardcodedRevenue = 113_205_924
    const ratio = derived.revenue / hardcodedRevenue
    assert(ratio > 0.8 && ratio < 1.2, `revenue ratio vs hardcoded: ${(ratio * 100).toFixed(1)}% (expect 80-120%)`)
  } else {
    console.log('  SKIP: DDS 2025 data insufficient for derivation')
  }
} else {
  console.log('  SKIP: no DDS data in dashboard-data.json')
}

// Тест с null/пустым DDS
if (typeof FD.deriveFactsFromDds === 'function') {
  assert(FD.deriveFactsFromDds(null, 2025) === null, 'null dds → null')
  assert(FD.deriveFactsFromDds([], 2025) === null, 'empty dds → null')
} else {
  console.log('  SKIP: deriveFactsFromDds not yet implemented')
}

// ─── Fix 4: initFromDds в CostModel ─────────────────────────────────────────
console.log('\n=== Fix 4: CostModel.initFromDds ===')

const CM = loadCostModel()
assert(typeof CM.initFromDds === 'function', 'initFromDds exported')

// ─── Итого ──────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
