import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authState = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))
const tableData = vi.hoisted(() => ({
  notifications: { data: [] as unknown[], error: null as { message: string } | null },
  clients: { data: [] as unknown[], error: null as { message: string } | null },
}))

function makeBuilder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'not', 'lte', 'update']) {
    b[m] = () => b
  }
  b.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authState.user } }) },
    from: (table: 'notifications' | 'clients') => makeBuilder(tableData[table]),
  }),
}))

import { getNotifications, markNotificationRead } from '@/app/(protected)/notifications/actions'

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = { id: 'u1' }
  tableData.notifications = {
    data: [{
      id: '11111111-1111-1111-1111-111111111111', subtype: 'missed', client_id: 'c1',
      phone: '+7700', event_count: 2, status: 'unread', updated_at: '2026-06-26T10:00:00.000Z',
      client: { name: 'Иван' },
    }],
    error: null,
  }
  tableData.clients = {
    data: [{ id: 'c2', name: 'Пётр', phone: '+7701', next_action_at: '2026-06-26T09:00:00.000Z', next_action_type: 'callback' }],
    error: null,
  }
})

describe('getNotifications', () => {
  it('требует авторизации', async () => {
    authState.user = null
    const res = await getNotifications()
    expect(res.success).toBe(false)
  })

  it('сливает звонки и задачи, считает бейдж и сортирует новейшие сверху', async () => {
    const res = await getNotifications()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.items).toHaveLength(2)
    expect(res.items[0].kind).toBe('call_inbound') // 10:00 новее 09:00
    expect(res.items[0].clientName).toBe('Иван')
    expect(res.unreadCount).toBe(2) // 1 непрочитанный звонок + 1 дозревшая задача
  })
})

describe('markNotificationRead', () => {
  it('отклоняет некорректный id', async () => {
    const res = await markNotificationRead('not-a-uuid')
    expect(res.success).toBe(false)
  })

  it('успешно при валидном uuid', async () => {
    const res = await markNotificationRead('550e8400-e29b-41d4-a716-446655440000')
    expect(res.success).toBe(true)
  })
})
