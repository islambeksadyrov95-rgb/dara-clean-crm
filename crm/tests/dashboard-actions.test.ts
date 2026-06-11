import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Управляемое состояние моков Supabase.
const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  profiles: [] as Array<{ id: string; name: string | null; email: string | null }>,
  todayCalls: [] as Array<{ manager_id: string; status: string; sub_status: string | null }>,
  todayOrders: [] as Array<{ manager_id: string; amount: number; discount_amount: number }>,
  monthOrders: [] as Array<{ amount: number; discount_amount: number }>,
  plans: [] as Array<Record<string, number>>,
  monthCalls: [] as Array<{ client_id: string | null; status: string; sub_status: string | null }>,
  lowScoreCalls: [] as Array<Record<string, unknown>>,
  clientsCount: 0,
  monthOrdersCount: 0,
}))

// Гибкий построитель запроса: цепочка возвращает себя и резолвится в нужные данные.
function makeQuery(table: string, isHeadCount: boolean) {
  const result: { data: unknown; error: null; count?: number } = { data: [], error: null }

  if (isHeadCount) {
    result.data = null
    result.count = table === 'clients' ? state.clientsCount : state.monthOrdersCount
  }

  const chain: Record<string, unknown> = {}
  const self = () => chain
  const methods = ['eq', 'neq', 'gte', 'lte', 'lt', 'not', 'order', 'limit', 'in', 'is']
  methods.forEach((m) => {
    chain[m] = self
  })
  // Промис-совместимость: await на цепочке вернёт result.
  chain.then = (resolve: (v: typeof result) => unknown) => resolve(result)
  return chain
}

// Маршрутизация набора данных по СОДЕРЖИМОМУ select-колонок (детерминированно при
// параллельном Promise.all, в отличие от счётчиков порядка вызова).
function pickData(table: string, cols: string): unknown {
  if (table === 'call_logs') {
    if (cols.includes('call_score')) return state.lowScoreCalls
    if (cols.includes('client_id')) return state.monthCalls // воронка (уникальные)
    return state.todayCalls // manager_id, status, sub_status
  }
  if (table === 'orders') {
    if (cols.includes('manager_id')) return state.todayOrders
    return state.monthOrders // amount, discount_amount
  }
  if (table === 'profiles') return state.profiles
  if (table === 'sales_plans') return state.plans
  return []
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => ({
      select: (cols: string, opts?: { head?: boolean }) => {
        const isHeadCount = opts?.head === true
        const chain = makeQuery(table, isHeadCount)
        if (!isHeadCount) {
          ;(chain as Record<string, unknown>).then = (resolve: (v: unknown) => unknown) =>
            resolve({ data: pickData(table, cols), error: null })
        }
        return chain
      },
    }),
  }),
}))

import { getDashboardData } from '@/app/(protected)/dashboard/actions'

beforeEach(() => {
  state.user = null
  state.profiles = []
  state.todayCalls = []
  state.todayOrders = []
  state.monthOrders = []
  state.plans = []
  state.monthCalls = []
  state.lowScoreCalls = []
  state.clientsCount = 0
  state.monthOrdersCount = 0
})

describe('getDashboardData — авторизация', () => {
  it('отклоняет неаутентифицированных', async () => {
    await expect(getDashboardData()).rejects.toThrow()
  })

  it('отклоняет не-админа (менеджера)', async () => {
    state.user = { id: 'm1', app_metadata: { role: 'manager' } }
    await expect(getDashboardData()).rejects.toThrow()
  })
})

describe('getDashboardData — агрегации (админ)', () => {
  beforeEach(() => {
    state.user = { id: 'admin1', app_metadata: { role: 'admin' } }
    state.profiles = [{ id: 'mgr1', name: 'иван', email: 'ivan@x.kz' }]
  })

  it('WhatsApp-отправки НЕ считаются звонками', async () => {
    state.todayCalls = [
      { manager_id: 'mgr1', status: 'reached', sub_status: null }, // звонок
      { manager_id: 'mgr1', status: 'reached', sub_status: 'sent_whatsapp' }, // WhatsApp
      { manager_id: 'mgr1', status: 'not_reached', sub_status: null }, // звонок
    ]
    const data = await getDashboardData()
    const mgr = data.today.find((t) => t.managerId === 'mgr1')
    expect(mgr?.calls).toBe(2) // только два звонка, WhatsApp исключён
    expect(mgr?.whatsapp).toBe(1)
    expect(mgr?.reached).toBe(1)
  })

  it('считает прогноз по текущему темпу и проценту плана', async () => {
    // Факт месяца: 2 заказа на 100000 нетто.
    state.monthOrders = [
      { amount: 60000, discount_amount: 0 },
      { amount: 50000, discount_amount: 10000 },
    ]
    state.plans = [{ carpets_target: 200000, furniture_target: 0, curtains_target: 0, repeat_target: 0, dry_clean_target: 0, blankets_target: 0 }]
    const data = await getDashboardData()
    expect(data.planFact.monthRevenue).toBe(100000)
    expect(data.planFact.monthPlan).toBe(200000)
    expect(data.planFact.planPercent).toBe(50)
    // Прогноз = (revenue / прошедшие дни) * 22; всегда >= факта при темпе.
    expect(data.planFact.forecastRevenue).toBeGreaterThanOrEqual(data.planFact.monthRevenue)
    expect(typeof data.planFact.hasEnoughData).toBe('boolean')
  })

  it('воронка считает уникальных обзвоненных клиентов через Set (WhatsApp исключён)', async () => {
    state.monthCalls = [
      { client_id: 'c1', status: 'reached', sub_status: null },
      { client_id: 'c1', status: 'not_reached', sub_status: null }, // тот же клиент → 1 уникальный
      { client_id: 'c2', status: 'reached', sub_status: null },
      { client_id: 'c3', status: 'reached', sub_status: 'sent_whatsapp' }, // WhatsApp — не обзвон
    ]
    state.clientsCount = 500
    state.monthOrdersCount = 7
    const data = await getDashboardData()
    expect(data.funnel.base).toBe(500)
    expect(data.funnel.called).toBe(2) // c1, c2 (c3 — только WhatsApp)
    expect(data.funnel.reached).toBe(2) // c1, c2
    expect(data.funnel.orders).toBe(7)
  })
})
