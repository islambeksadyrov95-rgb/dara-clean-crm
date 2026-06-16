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
          const conds: Array<(r: Record<string, unknown>) => boolean> = []
          const api = {
            eq(col: string, val: unknown) { conds.push((r) => r[col] === val); return api },
            in(col: string, vals: unknown[]) { conds.push((r) => vals.includes(r[col])); return api },
            is(col: string, val: unknown) { conds.push((r) => (r[col] ?? null) === val); return api },
            then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
              resolve({ data: tables[table].filter((r) => conds.every((fn) => fn(r))), error: null })
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
            is(col: string, val: unknown) {
              conds.push((r) => (r[col] ?? null) === val)
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

// importClients RETIRED (D2, 2026-06-16): Excel-импорт отключён, данные идут через Agbis API.
// Функция — no-op guard: ничего не пишет, возвращает skipped + ошибку. Тесты проверяют именно это.
describe('importClients (retired no-op guard)', () => {
  it('writes nothing and reports the import is disabled', async () => {
    const res = await importClients(
      [client(), client({ phone: '+77002223344' })],
      [{ phone: '+77001112233', order_date: '2026-01-10', amount: 1000, service: null, address: null }]
    )
    expect(res.skipped).toBe(2)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.batchId).toBeNull()
    // Никаких записей в таблицы и никаких recalc-RPC — guard не трогает данные.
    expect(state.tables.clients.length).toBe(0)
    expect(state.tables.order_history.length).toBe(0)
    expect(state.rpcCalls.length).toBe(0)
  })
})

describe('rollbackImport', () => {
  it('rejects non-admin', async () => {
    state.user = null
    const res = await rollbackImport('batch-x')
    expect(res.ok).toBe(false)
  })

  it('deletes raw Excel batch rows and recalculates aggregates', async () => {
    // Seed a client + one raw imported row (agbis_dor_id = null) for the batch.
    state.tables.clients.push({
      id: 'c1', phone: '+77001112233',
      total_orders: 1, total_spent: 1500, avg_order_value: 1500, last_order_date: '2026-01-10',
    })
    state.tables.order_history.push({
      id: 'h1', client_id: 'c1', import_batch_id: 'batch-1', agbis_dor_id: null, amount: 1500, order_date: '2026-01-10',
    })

    const rb = await rollbackImport('batch-1')
    expect(rb.ok).toBe(true)
    expect(rb.deleted).toBe(1)
    expect(state.tables.order_history.filter((h) => h.import_batch_id === 'batch-1').length).toBe(0)
    const after = state.tables.clients.find((x) => x.id === 'c1')
    expect(after?.total_orders).toBe(0)
    expect(after?.total_spent).toBe(0)
    expect(after?.avg_order_value).toBe(0)
    expect(after?.last_order_date).toBeNull()
  })

  it('keeps enriched (agbis_dor_id) rows — only raw Excel rows are rolled back', async () => {
    state.tables.clients.push({ id: 'c1', phone: '+7700', total_orders: 1 })
    state.tables.order_history.push({
      id: 'h1', client_id: 'c1', import_batch_id: 'batch-1', agbis_dor_id: '100', amount: 5000, order_date: '2026-01-10',
    })
    const rb = await rollbackImport('batch-1')
    expect(rb.ok).toBe(true)
    expect(rb.deleted).toBe(0) // enriched row preserved
    expect(state.tables.order_history.length).toBe(1)
  })
})
