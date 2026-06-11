import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// In-memory tables for the admin client mock.
type Tables = {
  clients: Array<Record<string, unknown>>
  order_history: Array<Record<string, unknown>>
  orders: Array<Record<string, unknown>>
}

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  role: 'admin' as string,
  managers: [{ id: 'm1' }, { id: 'm2' }] as Array<{ id: string }>,
  tables: { clients: [], order_history: [], orders: [] } as {
    clients: Array<Record<string, unknown>>
    order_history: Array<Record<string, unknown>>
    orders: Array<Record<string, unknown>>
  },
  // Записываем каждый вызов recalc RPC: какие client_ids пришли в чанке.
  rpcCalls: [] as Array<{ name: string; clientIds: string[] }>,
}))

vi.mock('@/lib/auth/get-user-role', () => ({
  getUserRole: () => state.role,
}))

vi.mock('@/lib/auth/roles', () => ({
  requireAdmin: async () =>
    state.user ? { ok: true, user: state.user } : { ok: false, error: 'denied' },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => ({
      select: () => ({
        neq: async () => (table === 'profiles' ? { data: state.managers, error: null } : { data: [], error: null }),
      }),
    }),
  }),
}))

// Recompute aggregates exactly like the recalc_client_aggregates SQL RPC:
// order_history (all sources) + live orders, LEFT JOIN from the requested ids so
// clients without any orders get 0/0/0/null.
function recalcAggregates(tables: Tables, clientIds: string[]) {
  for (const id of clientIds) {
    const hist = tables.order_history.filter((r) => r.client_id === id)
    const ord = tables.orders.filter((r) => r.client_id === id)
    const count = hist.length + ord.length
    const spent =
      hist.reduce((s, r) => s + (r.amount as number), 0) +
      ord.reduce((s, r) => s + (r.amount as number), 0)
    const dates = [
      ...hist.map((r) => r.order_date as string),
      ...ord.map((r) => (r.created_at as string).slice(0, 10)),
    ].filter(Boolean)
    const lastDate = dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null
    const client = tables.clients.find((c) => c.id === id)
    if (client) {
      client.total_orders = count
      client.total_spent = spent
      client.avg_order_value = count > 0 ? Math.round(spent / count) : 0
      client.last_order_date = lastDate
    }
  }
}

// Minimal query-builder over in-memory tables.
function makeAdmin(tables: Tables) {
  let nextId = 1
  return {
    rpc(name: string, args: { p_client_ids: string[] }) {
      state.rpcCalls.push({ name, clientIds: args.p_client_ids })
      if (name === 'recalc_client_aggregates') {
        recalcAggregates(tables, args.p_client_ids)
      }
      return Promise.resolve({ error: null })
    },
    from(table: keyof Tables) {
      return {
        select(_cols: string) {
          const rows = tables[table]
          const api = {
            _filtered: rows,
            in(col: string, vals: string[]) {
              api._filtered = api._filtered.filter((r) => vals.includes(r[col] as string))
              return Promise.resolve({ data: api._filtered, error: null })
            },
            eq(col: string, val: string) {
              api._filtered = api._filtered.filter((r) => r[col] === val)
              return Promise.resolve({ data: api._filtered, error: null })
            },
          }
          return api
        },
        upsert(payload: Array<Record<string, unknown>>, _opts: unknown) {
          const out: Array<Record<string, unknown>> = []
          for (const row of payload) {
            const existing = tables.clients.find((c) => c.phone === row.phone)
            if (existing) {
              Object.assign(existing, row)
              out.push(existing)
            } else {
              const created = new Date().toISOString()
              const rec = { id: `c${nextId++}`, created_at: created, updated_at: created, ...row }
              tables.clients.push(rec)
              out.push(rec)
            }
          }
          return { select: (_c: string) => Promise.resolve({ data: out, error: null }) }
        },
        insert(payload: Array<Record<string, unknown>>) {
          for (const row of payload) tables[table].push({ id: `h${nextId++}`, ...row })
          return Promise.resolve({ error: null })
        },
        delete() {
          const conds: Array<(r: Record<string, unknown>) => boolean> = []
          const applyDelete = () => {
            const kept = tables[table].filter((r) => !conds.every((fn) => fn(r)))
            tables[table].length = 0
            tables[table].push(...kept)
            return { error: null }
          }
          // Thenable that also supports chained .eq()/.in(); resolves to apply the delete.
          const api: Record<string, unknown> = {
            eq(col: string, val: string) {
              conds.push((r) => r[col] === val)
              return api
            },
            in(col: string, vals: string[]) {
              conds.push((r) => vals.includes(r[col] as string))
              return api
            },
            then(resolve: (v: { error: null }) => void) {
              resolve(applyDelete())
            },
          }
          return api
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(col: string, val: string) {
              const row = tables[table].find((r) => r[col] === val)
              if (row) Object.assign(row, payload)
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(state.tables as unknown as Tables),
}))

import { importClients, rollbackImport } from '@/app/(protected)/import/actions'

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'admin1' }
  state.role = 'admin'
  state.managers = [{ id: 'm1' }, { id: 'm2' }]
  state.tables = { clients: [], order_history: [], orders: [] }
  state.rpcCalls = []
})

const client = (over: Partial<Record<string, unknown>> = {}) => ({
  name: 'Test',
  phone: '+77001112233',
  address: null,
  total_orders: 0,
  total_spent: 0,
  avg_order_value: 0,
  last_order_date: null,
  ...over,
})

describe('importClients aggregates', () => {
  it('rejects non-admin', async () => {
    state.role = 'manager'
    const res = await importClients([client()], [])
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.batchId).toBeNull()
  })

  it('recalculates aggregates from history + real orders', async () => {
    // Seed a real order for this client (will be matched after upsert by client_id).
    const res = await importClients(
      [client({ phone: '+77001112233' })],
      [
        { phone: '+77001112233', order_date: '2026-01-10', amount: 1000, service: 'ковёр', address: null },
        { phone: '+77001112233', order_date: '2026-02-20', amount: 2000, service: 'ковёр', address: null },
      ]
    )
    const cid = state.tables.clients[0].id as string
    // add a real order for the same client
    state.tables.orders.push({ client_id: cid, amount: 3000, created_at: '2026-03-01T10:00:00Z' })
    // re-run import to trigger recalc including the real order
    await importClients(
      [client({ phone: '+77001112233' })],
      [
        { phone: '+77001112233', order_date: '2026-01-10', amount: 1000, service: 'ковёр', address: null },
        { phone: '+77001112233', order_date: '2026-02-20', amount: 2000, service: 'ковёр', address: null },
      ]
    )
    const c = state.tables.clients.find((x) => x.id === cid)
    expect(c?.total_orders).toBe(3) // 2 history + 1 real order
    expect(c?.total_spent).toBe(6000) // 1000 + 2000 + 3000
    expect(c?.avg_order_value).toBe(2000) // Math.round(6000/3)
    expect(c?.last_order_date).toBe('2026-03-01') // max(history, orders.created_at::date)
    expect(res.ordersInserted).toBe(2)
  })

  it('is idempotent — re-import does not duplicate history', async () => {
    const orders = [
      { phone: '+77001112233', order_date: '2026-01-10', amount: 500, service: null, address: null },
    ]
    await importClients([client()], orders)
    await importClients([client()], orders)
    const cid = state.tables.clients[0].id as string
    const histForClient = state.tables.order_history.filter((h) => h.client_id === cid && h.source === 'agbis_import')
    expect(histForClient.length).toBe(1)
  })

  it('does not touch manual history rows', async () => {
    await importClients([client()], [])
    const cid = state.tables.clients[0].id as string
    state.tables.order_history.push({ id: 'manual1', client_id: cid, source: 'manual', amount: 999, order_date: '2026-01-01' })
    await importClients([client()], [{ phone: '+77001112233', order_date: '2026-02-02', amount: 100, service: null, address: null }])
    const manual = state.tables.order_history.find((h) => h.id === 'manual1')
    expect(manual).toBeDefined()
  })

  it('counts unmatched orders when phone not in clients', async () => {
    const res = await importClients(
      [client({ phone: '+77001112233' })],
      [{ phone: '+79990000000', order_date: '2026-01-10', amount: 100, service: null, address: null }]
    )
    expect(res.unmatchedOrders).toBe(1)
    expect(res.ordersInserted).toBe(0)
  })

  it('counts zeroAmountOrders', async () => {
    const res = await importClients(
      [client()],
      [{ phone: '+77001112233', order_date: '2026-01-10', amount: 0, service: null, address: null }]
    )
    expect(res.zeroAmountOrders).toBe(1)
    expect(res.ordersInserted).toBe(1)
  })

  it('calls recalc RPC with the affected client ids', async () => {
    await importClients([client({ phone: '+77001112233' })], [])
    const cid = state.tables.clients[0].id as string
    const recalc = state.rpcCalls.filter((c) => c.name === 'recalc_client_aggregates')
    expect(recalc.length).toBe(1)
    expect(recalc[0].clientIds).toEqual([cid])
  })

  it('chunks recalc RPC ids by 2000', async () => {
    const many = Array.from({ length: 4534 }, (_, i) => ({
      name: `Client ${i}`,
      phone: `+7700${String(i).padStart(7, '0')}`,
      address: null,
      total_orders: 0,
      total_spent: 0,
      avg_order_value: 0,
      last_order_date: null,
    }))
    await importClients(many, [])
    const recalc = state.rpcCalls.filter((c) => c.name === 'recalc_client_aggregates')
    // 4534 ids → chunks of 2000 → 3 RPC calls (2000 + 2000 + 534).
    expect(recalc.length).toBe(3)
    expect(recalc[0].clientIds.length).toBe(2000)
    expect(recalc[1].clientIds.length).toBe(2000)
    expect(recalc[2].clientIds.length).toBe(534)
    const total = recalc.reduce((s, c) => s + c.clientIds.length, 0)
    expect(total).toBe(4534)
  })
})

describe('rollbackImport', () => {
  it('rejects non-admin', async () => {
    state.user = null
    const res = await rollbackImport('batch-x')
    expect(res.ok).toBe(false)
  })

  it('deletes batch rows and recalculates aggregates', async () => {
    const res = await importClients(
      [client()],
      [{ phone: '+77001112233', order_date: '2026-01-10', amount: 1500, service: null, address: null }]
    )
    const batchId = res.batchId as string
    const cid = state.tables.clients[0].id as string
    const before = state.tables.clients.find((x) => x.id === cid)
    expect(before?.total_orders).toBe(1)

    const rb = await rollbackImport(batchId)
    expect(rb.ok).toBe(true)
    expect(rb.deleted).toBe(1)
    const remaining = state.tables.order_history.filter((h) => h.import_batch_id === batchId)
    expect(remaining.length).toBe(0)
    const after = state.tables.clients.find((x) => x.id === cid)
    expect(after?.total_orders).toBe(0)
    expect(after?.total_spent).toBe(0)
    expect(after?.avg_order_value).toBe(0)
    expect(after?.last_order_date).toBeNull()
  })
})
