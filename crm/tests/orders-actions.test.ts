import { describe, it, expect, vi, beforeEach } from 'vitest'

// deleteOrder: auth/роль через user-клиент, само удаление и пересчёт агрегатов —
// через admin-клиент, т.к. у таблицы orders нет DELETE RLS-политики (user-клиент
// удалил бы 0 строк и вернул фейковый success).
const mockUserClient = {
  auth: { getUser: vi.fn() },
}
const mockAdminClient = {
  from: vi.fn(),
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockUserClient)),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

import { deleteOrder } from '@/app/(protected)/orders/actions'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteOrder — auth', () => {
  it('rejects unauthenticated callers', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await deleteOrder('order-1')
    expect(res.success).toBe(false)
    expect(mockAdminClient.from).not.toHaveBeenCalled()
  })

  it('rejects non-admin managers', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', user_metadata: { role: 'manager' } } },
    })
    const res = await deleteOrder('order-1')
    expect(res.success).toBe(false)
    expect(mockAdminClient.from).not.toHaveBeenCalled()
  })
})

describe('deleteOrder — admin path uses admin client', () => {
  it('deletes the order via the admin client (bypassing RLS)', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin1', user_metadata: { role: 'admin' } } },
    })

    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const mockDelete = vi.fn(() => ({ eq: deleteEq }))

    // fetch order: select('client_id').eq('id').single()
    const fetchSingle = vi.fn().mockResolvedValue({ data: { client_id: 'c1' }, error: null })
    const fetchEq = vi.fn(() => ({ single: fetchSingle }))
    // remaining orders: select('amount, created_at').eq('client_id').order()
    const remainingOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const remainingEq = vi.fn(() => ({ order: remainingOrder }))

    let ordersSelectCall = 0
    const mockSelect = vi.fn(() => {
      ordersSelectCall += 1
      return ordersSelectCall === 1 ? { eq: fetchEq } : { eq: remainingEq }
    })

    const clientUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const clientUpdate = vi.fn(() => ({ eq: clientUpdateEq }))

    mockAdminClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return { select: mockSelect, delete: mockDelete }
      if (table === 'clients') return { update: clientUpdate }
      return {}
    })

    const res = await deleteOrder('order-1')

    expect(mockAdminClient.from).toHaveBeenCalledWith('orders')
    expect(mockDelete).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('id', 'order-1')
    expect(res.success).toBe(true)
  })
})
