import { describe, it, expect, vi, beforeEach } from 'vitest'

// deleteOrder: auth/роль через user-клиент, само удаление и пересчёт агрегатов —
// через admin-клиент, т.к. у таблицы orders нет DELETE RLS-политики (user-клиент
// удалил бы 0 строк и вернул фейковый success).
const mockUserClient = {
  auth: { getUser: vi.fn() },
}
const mockAdminClient = {
  from: vi.fn(),
  rpc: vi.fn(),
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
      data: { user: { id: 'u1', app_metadata: { role: 'manager' } } },
    })
    const res = await deleteOrder('order-1')
    expect(res.success).toBe(false)
    expect(mockAdminClient.from).not.toHaveBeenCalled()
  })
})

describe('deleteOrder — admin path uses admin client', () => {
  // Хелпер: настраивает admin-моки для удачного удаления заказа клиента c1.
  function setupAdminDelete() {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin1', app_metadata: { role: 'admin' } } },
    })

    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const mockDelete = vi.fn(() => ({ eq: deleteEq }))

    // fetch order: select('client_id').eq('id').single()
    const fetchSingle = vi.fn().mockResolvedValue({ data: { client_id: 'c1' }, error: null })
    const fetchEq = vi.fn(() => ({ single: fetchSingle }))
    const mockSelect = vi.fn(() => ({ eq: fetchEq }))

    mockAdminClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return { select: mockSelect, delete: mockDelete }
      return {}
    })

    return { mockDelete, deleteEq }
  }

  it('deletes the order via the admin client (bypassing RLS)', async () => {
    const { mockDelete, deleteEq } = setupAdminDelete()
    mockAdminClient.rpc.mockResolvedValue({ error: null })

    const res = await deleteOrder('order-1')

    expect(mockAdminClient.from).toHaveBeenCalledWith('orders')
    expect(mockDelete).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('id', 'order-1')
    expect(res.success).toBe(true)
  })

  it('recomputes aggregates via recalc_client_aggregates RPC (orders ∪ order_history), not a local orders-only recompute', async () => {
    setupAdminDelete()
    mockAdminClient.rpc.mockResolvedValue({ error: null })

    await deleteOrder('order-1')

    // Агрегаты считает единый RPC по объединению orders + order_history (с дедупом Agbis),
    // а НЕ прямой UPDATE clients по одной таблице orders.
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('recalc_client_aggregates', {
      p_client_ids: ['c1'],
    })
    expect(mockAdminClient.from).not.toHaveBeenCalledWith('clients')
  })

  it('returns failure when the recalc RPC errors', async () => {
    setupAdminDelete()
    mockAdminClient.rpc.mockResolvedValue({ error: { message: 'boom' } })

    const res = await deleteOrder('order-1')

    expect(res.success).toBe(false)
  })
})
