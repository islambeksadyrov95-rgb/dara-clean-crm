import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// State shared across mocked clients
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  user: { id: 'u1' } as Record<string, unknown> | null,
  callRows: [] as Array<Record<string, unknown>>,
  callCount: 0,
  callError: null as { message: string } | null,
  orderRows: [] as Array<Record<string, unknown>>,
  orderCount: 0,
  orderError: null as { message: string } | null,
  users: [] as Array<{ id: string; email: string }>,
}))

// ---------------------------------------------------------------------------
// Mock: user Supabase client (RLS-filtered)
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: (table: string) => {
      if (table === 'call_logs') {
        return makeQueryBuilder(
          () => ({ data: state.callRows, count: state.callCount, error: state.callError }),
        )
      }
      if (table === 'orders') {
        return makeQueryBuilder(
          () => ({ data: state.orderRows, count: state.orderCount, error: state.orderError }),
        )
      }
      return makeQueryBuilder(() => ({ data: [], count: 0, error: null }))
    },
  }),
}))

// Mock: admin client (only used for listUsers)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: state.users }, error: null }),
      },
    },
  }),
}))

/** Chainable query builder that returns the supplied resolver at the terminal call. */
function makeQueryBuilder(resolve: () => unknown) {
  const chain: Record<string, unknown> = {}
  const terminal = () => Promise.resolve(resolve())
  const ret = () => chain
  chain.select = ret
  chain.order = ret
  chain.range = ret
  chain.limit = ret
  chain.gte = ret
  chain.lte = ret
  chain.eq = ret
  // Final awaitable call
  chain.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onfulfilled)
  return chain
}

import { getCommunications } from '@/app/(protected)/calls/actions'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CALL_ROW = {
  id: 'c1',
  client_id: 'cl1',
  status: 'reached',
  sub_status: 'ordered',
  reason: null,
  notes: 'тест',
  created_at: '2026-06-11T10:00:00Z',
  manager_id: 'u1',
  clients: { id: 'cl1', name: 'Асель Иманова', phone: '+77011234567' },
}

const ORDER_ROW = {
  id: 'o1',
  client_id: 'cl2',
  services: ['Ковёр 3×4'],
  amount: 15000,
  comment: 'срочно',
  created_at: '2026-06-11T09:00:00Z',
  manager_id: 'u1',
  clients: { id: 'cl2', name: 'Берик Сейткали', phone: '+77029876543' },
}

beforeEach(() => {
  state.user = { id: 'u1' }
  state.callRows = []
  state.callCount = 0
  state.callError = null
  state.orderRows = []
  state.orderCount = 0
  state.orderError = null
  state.users = [{ id: 'u1', email: 'manager@dara.kz' }]
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('getCommunications', () => {
  describe('auth guard', () => {
    it('returns empty result when user is not authenticated', async () => {
      state.user = null
      const result = await getCommunications({})
      expect(result.entries).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('call logs', () => {
    it('maps call_log row to CommunicationEntry with clientId', async () => {
      state.callRows = [CALL_ROW]
      state.callCount = 1

      const result = await getCommunications({ type: 'call' })

      expect(result.total).toBe(1)
      expect(result.entries).toHaveLength(1)
      const entry = result.entries[0]
      expect(entry.type).toBe('call')
      expect(entry.clientId).toBe('cl1')
      expect(entry.clientName).toBe('Асель Иманова')
      expect(entry.clientPhone).toBe('+77011234567')
      expect(entry.status).toBe('reached')
      expect(entry.subStatus).toBe('ordered')
      expect(entry.notes).toBe('тест')
      expect(entry.managerEmail).toBe('manager@dara.kz')
    })

    it('falls back to client_id when clients relation is null', async () => {
      state.callRows = [{ ...CALL_ROW, clients: null }]
      state.callCount = 1

      const result = await getCommunications({ type: 'call' })
      expect(result.entries[0].clientId).toBe('cl1')
      expect(result.entries[0].clientName).toBe('Без имени')
    })

    it('returns empty entries and total=0 on query error', async () => {
      state.callError = { message: 'DB error' }

      const result = await getCommunications({ type: 'call' })
      expect(result.entries).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('orders', () => {
    it('maps order row to CommunicationEntry with clientId and amount', async () => {
      state.orderRows = [ORDER_ROW]
      state.orderCount = 1

      const result = await getCommunications({ type: 'order' })

      expect(result.total).toBe(1)
      const entry = result.entries[0]
      expect(entry.type).toBe('order')
      expect(entry.clientId).toBe('cl2')
      expect(entry.status).toBe('order')
      expect(entry.amount).toBe(15000)
      expect(entry.subStatus).toBe('Ковёр 3×4')
      expect(entry.notes).toBe('срочно')
    })
  })

  describe('pagination', () => {
    it('returns total count separately from entries length', async () => {
      // Simulate 120 total records but only PAGE_SIZE (50) returned
      state.callRows = Array.from({ length: 50 }, (_, i) => ({
        ...CALL_ROW,
        id: `c${i}`,
        clients: { id: `cl${i}`, name: `Клиент ${i}`, phone: '+77010000000' },
      }))
      state.callCount = 120

      const result = await getCommunications({ type: 'call', offset: 0 })
      expect(result.total).toBe(120)
      expect(result.entries.length).toBe(50)
    })
  })
})
