/**
 * Регрессия: compute() на фикстуре — KPI.fact = сумма paid, сумма по продуктам согласована.
 */
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const loadAnalytics = () => {
  const code = fs.readFileSync(path.join(root, 'js', 'analytics.js'), 'utf8')
  const ctx = { window: {}, globalThis: {} }
  ctx.globalThis = ctx.window
  vm.runInNewContext(code, ctx)
  return ctx.window.DashboardAnalytics
}

const { compute } = loadAnalytics()

const fixture = {
  meta: { currency: 'KZT' },
  funnelStages: ['lead', 'contact', 'dialog', 'deal', 'payment'],
  clients: [{ id: 'c1', name: 'A', segment: 'B2C', registeredAt: '2025-01-01' }],
  managers: [{ id: 'm1', name: 'M' }],
  products: [{ id: 'p1', name: 'P' }],
  transactions: [
    { id: 't1', date: '2025-06-15', clientId: 'c1', managerId: 'm1', productId: 'p1', amount: 1000, planAmount: 900, status: 'paid', funnelStage: 'payment', source: 'x' },
    { id: 't2', date: '2025-06-16', clientId: 'c1', managerId: 'm1', productId: 'p1', amount: 500, planAmount: 500, status: 'paid', funnelStage: 'payment', source: 'x' }
  ],
  plans: { daily: [{ date: '2025-06-15', amount: 800 }, { date: '2025-06-16', amount: 800 }], funnel: {} },
  marketingDaily: [],
  funnelSnapshots: [],
  lossReasons: []
}

const filters = {
  dateFrom: '2025-06-01',
  dateTo: '2025-06-30',
  granularity: 'day',
  managerId: '',
  clientId: '',
  productId: ''
}

const r = compute(fixture, filters)
const sumPaid = fixture.transactions.filter((t) => t.status === 'paid').reduce((s, t) => s + t.amount, 0)

if (Math.abs(r.kpi.fact - sumPaid) > 0.01) {
  console.error('FAIL: kpi.fact', r.kpi.fact, 'expected', sumPaid)
  process.exit(1)
}

const planExpected = 800 + 800
if (Math.abs(r.kpi.plan - planExpected) > 0.01) {
  console.error('FAIL: kpi.plan with daily plan', r.kpi.plan, 'expected', planExpected)
  process.exit(1)
}

let psum = 0
r.products.rows.forEach((row) => {
  psum += row.fact
})
if (Math.abs(psum - sumPaid) > 0.01) {
  console.error('FAIL: product sum', psum, 'expected', sumPaid)
  process.exit(1)
}

console.log('OK compute regression (KZT fixture)')
