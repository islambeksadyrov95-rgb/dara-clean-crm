/**
 * Сверка: загруженный dashboard-data.json — KPI.fact = SUM(paid), сумма по продуктам = факт.
 */
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dataPath = path.join(root, 'data', 'dashboard-data.json')

const loadAnalytics = () => {
  const code = fs.readFileSync(path.join(root, 'js', 'analytics.js'), 'utf8')
  const ctx = { window: {} }
  vm.runInNewContext(code, ctx)
  return ctx.window.DashboardAnalytics.compute
}

const compute = loadAnalytics()
const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
if (raw.meta?.currency !== 'KZT') {
  console.error('FAIL: meta.currency must be KZT')
  process.exit(1)
}

const from = raw.transactions.length ? raw.transactions.map((t) => t.date).sort()[0] : '2025-01-01'
const to = raw.transactions.length ? raw.transactions.map((t) => t.date).sort().slice(-1)[0] : '2025-12-31'

const r = compute(raw, {
  dateFrom: from,
  dateTo: to,
  granularity: 'day',
  managerId: '',
  clientId: '',
  productId: ''
})

const sumPaid = raw.transactions.filter((t) => t.status === 'paid').reduce((s, t) => s + t.amount, 0)
if (Math.abs(r.kpi.fact - sumPaid) > 0.01) {
  console.error('FAIL kpi.fact', r.kpi.fact, 'vs sum paid', sumPaid)
  process.exit(1)
}

let psum = 0
r.products.rows.forEach((row) => {
  psum += row.fact
})
if (raw.transactions.length === 0 && sumPaid === 0 && r.kpi.fact === 0 && psum === 0) {
  console.log('OK verify-invariants (no transactions)', dataPath)
  process.exit(0)
}
if (Math.abs(psum - sumPaid) > 0.01) {
  console.error('FAIL products sum', psum, 'vs', sumPaid)
  process.exit(1)
}

console.log('OK verify-invariants', dataPath, 'fact=', r.kpi.fact)
