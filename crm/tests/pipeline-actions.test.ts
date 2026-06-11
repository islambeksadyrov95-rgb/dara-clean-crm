import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Состояние, которым управляют тесты.
const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  clientsCount: 0,
  withHistoryCount: 0,
  ordersCount: 0,
  callLogRows: [] as Array<{ client_id: string | null; status: string; sub_status: string | null; manager_id: string | null }>,
  orderRows: [] as Array<{ client_id: string | null; amount: number; manager_id: string | null }>,
  users: [] as Array<{ id: string; email: string; user_metadata: { name?: string } }>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))

// Builder, поддерживающий цепочку фильтров + head-count и .range() выборку.
function makeBuilder(table: string) {
  const ctx = { reachedOnly: false }
  const builder: Record<string, unknown> = {
    select: (_cols: string, opts?: { head?: boolean; count?: string }) => {
      if (opts?.head) {
        // head-count запрос — возвращаем заранее заданный count.
        const countBuilder: Record<string, unknown> = {
          eq: () => countBuilder,
          or: () => countBuilder,
          gte: () => countBuilder,
          lte: () => countBuilder,
          not: () => countBuilder,
          then: (resolve: (v: { count: number; error: null }) => unknown) => {
            let count = 0
            if (table === 'clients') count = ctx.reachedOnly ? state.withHistoryCount : state.clientsCount
            if (table === 'orders') count = state.ordersCount
            if (table === 'call_logs') count = state.callLogRows.length
            return Promise.resolve(resolve({ count, error: null }))
          },
        }
        // .not('last_order_date'...) помечает запрос «с историей».
        countBuilder.not = () => {
          ctx.reachedOnly = true
          return countBuilder
        }
        return countBuilder
      }
      // select без head — выборка строк через .range(). Билдер чейнится в любом
      // порядке (eq/gte/lte после range) и резолвится при await (then), как в supabase-js.
      const rangeCtx = { from: 0 }
      const rowBuilder: Record<string, unknown> = {
        eq: (col: string, val: string) => {
          if (col === 'status' && val === 'reached') ctx.reachedOnly = true
          return rowBuilder
        },
        or: () => rowBuilder,
        gte: () => rowBuilder,
        lte: () => rowBuilder,
        not: () => rowBuilder,
        range: (from: number) => {
          rangeCtx.from = from
          return rowBuilder
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
          if (rangeCtx.from > 0) return Promise.resolve(resolve({ data: [], error: null }))
          if (table === 'call_logs') {
            const rows = ctx.reachedOnly
              ? state.callLogRows.filter((r) => r.status === 'reached')
              : state.callLogRows
            return Promise.resolve(resolve({ data: rows, error: null }))
          }
          return Promise.resolve(resolve({ data: state.orderRows, error: null }))
        },
      }
      return rowBuilder
    },
  }
  return builder
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder(table),
    auth: { admin: { listUsers: async () => ({ data: { users: state.users }, error: null }) } },
  }),
}))

import { getPipelineFunnel, getPipelineByManager } from '@/app/(protected)/pipeline/actions'

beforeEach(() => {
  vi.clearAllMocks()
  state.user = null
  state.clientsCount = 0
  state.withHistoryCount = 0
  state.ordersCount = 0
  state.callLogRows = []
  state.orderRows = []
  state.users = []
})

describe('getPipelineFunnel', () => {
  it('throws when unauthenticated', async () => {
    await expect(getPipelineFunnel({})).rejects.toThrow('Не авторизован')
  })

  it('returns real client count (not capped at 1000)', async () => {
    state.user = { id: 'u1' }
    state.clientsCount = 4879
    state.withHistoryCount = 1200
    const res = await getPipelineFunnel({})
    expect(res.totalClients).toBe(4879)
    expect(res.withOrderHistory).toBe(1200)
  })

  it('counts unique called/reached clients excluding sent_whatsapp', async () => {
    state.user = { id: 'u1' }
    state.callLogRows = [
      { client_id: 'c1', status: 'reached', sub_status: null, manager_id: 'm1' },
      { client_id: 'c1', status: 'not_reached', sub_status: null, manager_id: 'm1' },
      { client_id: 'c2', status: 'reached', sub_status: null, manager_id: 'm1' },
    ]
    const res = await getPipelineFunnel({})
    expect(res.called).toBe(2) // c1, c2 уникальные
    expect(res.reached).toBe(2) // c1 (reached), c2 (reached)
  })

  it('aggregates orders revenue and unique ordered clients', async () => {
    state.user = { id: 'u1' }
    state.ordersCount = 3
    state.orderRows = [
      { client_id: 'c1', amount: 10000, manager_id: 'm1' },
      { client_id: 'c1', amount: 5000, manager_id: 'm1' },
      { client_id: 'c2', amount: 20000, manager_id: 'm2' },
    ]
    const res = await getPipelineFunnel({})
    expect(res.totalRevenue).toBe(35000)
    expect(res.ordered).toBe(2)
    expect(res.avgCheck).toBe(Math.round(35000 / 3))
  })
})

describe('getPipelineByManager', () => {
  it('throws when unauthenticated', async () => {
    await expect(getPipelineByManager({})).rejects.toThrow('Не авторизован')
  })

  it('aggregates calls/reached/orders per manager with conversion', async () => {
    state.user = { id: 'u1' }
    state.users = [{ id: 'm1', email: 'ivan@x.kz', user_metadata: { name: 'иван' } }]
    state.callLogRows = [
      { client_id: 'c1', status: 'reached', sub_status: null, manager_id: 'm1' },
      { client_id: 'c2', status: 'not_reached', sub_status: null, manager_id: 'm1' },
    ]
    state.orderRows = [{ client_id: 'c1', amount: 10000, manager_id: 'm1' }]
    const rows = await getPipelineByManager({})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ managerId: 'm1', name: 'Иван', calls: 2, reached: 1, orders: 1, conversion: 100 })
  })
})
