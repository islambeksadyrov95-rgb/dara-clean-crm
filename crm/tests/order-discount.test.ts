import { describe, it, expect, vi, beforeEach } from 'vitest'

// createOrder пишет amount и discount_amount в integer-колонки orders.
// Проверяем, что discount_amount всегда целое — даже когда процент скидки
// даёт дробный результат (amount=33333, 10% → 3333.3 → должно округлиться до 3333).
const state = vi.hoisted(() => ({
  insertArg: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'mgr1' } } }) },
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'c1',
                  name: 'Тест',
                  total_orders: 3,
                  total_spent: 90000,
                  assigned_manager_id: 'mgr1',
                },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      // orders
      return {
        insert: (payload: Record<string, unknown>) => {
          state.insertArg = payload
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'o1', created_at: '2026-06-12T00:00:00Z' },
                error: null,
              }),
            }),
          }
        },
      }
    },
  }),
}))

import { createOrder } from '@/app/(protected)/queue/order/actions'

beforeEach(() => {
  state.insertArg = null
})

describe('createOrder — целочисленные денежные значения', () => {
  it('округляет discount_amount до целого при дробном проценте', async () => {
    // amount=33333, повторный клиент + >30000 → 10%; одна услуга.
    // 33333 * 10 / 100 = 3333.3 → 3333 (целое)
    const res = await createOrder({
      clientId: 'c1',
      services: ['Ковры'],
      amount: 33333,
    })

    expect(res.success).toBe(true)
    expect(state.insertArg).not.toBeNull()
    const discount = state.insertArg?.discount_amount as number
    expect(Number.isInteger(discount)).toBe(true)
    expect(discount).toBe(3333)
  })

  it('пишет целый amount и discount_amount для всех путей скидки', async () => {
    // amount=12345, комплекс (2 услуги) → 15%; 12345*15/100 = 1851.75 → 1852
    const res = await createOrder({
      clientId: 'c1',
      services: ['Ковры', 'Шторы'],
      amount: 12345,
    })

    expect(res.success).toBe(true)
    const amount = state.insertArg?.amount as number
    const discount = state.insertArg?.discount_amount as number
    expect(Number.isInteger(amount)).toBe(true)
    expect(Number.isInteger(discount)).toBe(true)
    expect(discount).toBe(1852)
  })
})
