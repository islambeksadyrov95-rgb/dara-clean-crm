import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

vi.mock('@/lib/agbis/client', () => ({ agbisCall: vi.fn() }))

import { priceList, mapPriceItem } from '@/lib/agbis/commands'
import { agbisCall } from '@/lib/agbis/client'

beforeEach(() => vi.clearAllMocks())

describe('mapPriceItem', () => {
  it('maps a raw PriceList item to a typed item with integer-tenge price', () => {
    const raw = {
      id: '500',
      name: 'Чистка ковра',
      code: 'K1',
      unit: 'м2',
      price: '1 500,00',
      tovar_type: '2',
      group_c: 'Ковры',
      top_parent: 'Услуги',
      is_price_editable: '1',
      price_id: '0',
    }
    expect(mapPriceItem(raw)).toEqual({
      tovarId: '500',
      code: 'K1',
      name: 'Чистка ковра',
      unit: 'м2',
      price: 1500,
      tovarType: 2,
      groupName: 'Ковры',
      topParent: 'Услуги',
      orderAddonPackId: null,
      isPriceEditable: true,
      priceId: '0',
    })
  })

  it('returns null when id or name is missing', () => {
    expect(mapPriceItem({ name: 'x' })).toBeNull()
    expect(mapPriceItem({ id: '1' })).toBeNull()
  })
})

describe('priceList', () => {
  it('requests PriceList and maps the array, dropping invalid rows', async () => {
    ;(agbisCall as Mock).mockResolvedValue({
      error: 0,
      price_list: [
        { id: '1', name: 'A', price: '100,00' },
        { bad: 'row' },
      ],
    })
    const items = await priceList('0')
    expect(agbisCall).toHaveBeenCalledWith('PriceList', { params: { price_id: '0' } })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ tovarId: '1', name: 'A', price: 100 })
  })
})
