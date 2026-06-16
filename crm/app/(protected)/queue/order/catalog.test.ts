import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable query-builder mock: every method returns the builder; awaiting it yields {data,error}.
let result: { data: unknown; error: unknown }
function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gt', 'order']) builder[m] = () => builder
  ;(builder as { then: unknown }).then = (resolve: (v: typeof result) => void) => resolve(result)
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => makeBuilder() }),
}))

import { getOrderFormData } from './catalog'

beforeEach(() => {
  result = { data: [], error: null }
})

describe('getOrderFormData', () => {
  it('maps catalog rows and returns warehouses', async () => {
    result = {
      data: [{ agbis_tovar_id: '102419', name: 'Одеяло', price: 5000, unit: null, group_name: 'Одеяла' }],
      error: null,
    }
    const res = await getOrderFormData()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.services[0]).toEqual({
      tovarId: '102419', name: 'Одеяло', price: 5000, unit: null, group: 'Одеяла',
    })
    expect(res.data.warehouses.length).toBeGreaterThan(0)
  })

  it('falls back to "Прочее" when group is null', async () => {
    result = {
      data: [{ agbis_tovar_id: '1', name: 'X', price: 100, unit: null, group_name: null }],
      error: null,
    }
    const res = await getOrderFormData()
    expect(res.success && res.data.services[0].group).toBe('Прочее')
  })

  it('returns a generic error message on db failure (R1)', async () => {
    result = { data: null, error: { message: 'relation "agbis_price_items" ...' } }
    const res = await getOrderFormData()
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toBe('Не удалось загрузить каталог услуг')
  })
})
