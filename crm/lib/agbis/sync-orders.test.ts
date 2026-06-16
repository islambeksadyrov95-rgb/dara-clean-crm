import { describe, it, expect } from 'vitest'
import { orderHistoryFields, orderServiceItem, enrichAmount } from '@/lib/agbis/sync-orders'
import type { AgbisSyncOrder, AgbisSyncOrderService } from '@/lib/agbis/sync-types'

function order(over: Partial<AgbisSyncOrder>): AgbisSyncOrder {
  return {
    dorId: '100',
    docNum: '1-25',
    contrId: 'c1',
    amount: 12800,
    debet: null,
    dolg: null,
    orderDate: '2025-03-01',
    dateOut: null,
    statusId: 4,
    statusName: 'Исполненный',
    userId: '1',
    userName: 'Дарын',
    discount: null,
    services: [],
    products: [],
    ...over,
  }
}

function service(over: Partial<AgbisSyncOrderService>): AgbisSyncOrderService {
  return {
    dosId: '1',
    tovId: '500',
    service: 'Чистка ковра',
    code: 'K1',
    price: 1500,
    qty: 8,
    kfx: 1,
    discount: 10,
    lineAmount: 10800,
    statusId: 4,
    statusName: 'Исполненный',
    ...over,
  }
}

describe('orderHistoryFields', () => {
  it('maps Agbis order header fields for the history row', () => {
    expect(orderHistoryFields(order({ debet: 5000, dolg: 7800, dateOut: '2025-03-05', discount: 10 }))).toEqual({
      amount: 12800,
      agbis_dor_id: '100',
      agbis_doc_num: '1-25',
      agbis_user_name: 'Дарын',
      agbis_status_id: 4,
      agbis_status_name: 'Исполненный',
      agbis_debet: 5000,
      agbis_dolg: 7800,
      agbis_date_out: '2025-03-05',
      agbis_discount: 10,
    })
  })

  it('clamps a null or negative amount to 0 (amount CHECK >= 0)', () => {
    expect(orderHistoryFields(order({ amount: null })).amount).toBe(0)
    expect(orderHistoryFields(order({ amount: -500 })).amount).toBe(0)
  })
})

describe('orderServiceItem', () => {
  it('maps an Agbis service line to a history item row (is_product=false by default)', () => {
    expect(orderServiceItem(service({}))).toEqual({
      agbis_tovar_id: '500',
      name: 'Чистка ковра',
      qty: 8,
      kfx: 1,
      unit_price: 1500,
      line_amount: 10800,
      discount_percent: 10,
      addons: null,
      is_product: false,
    })
  })

  it('flags a product line with is_product=true', () => {
    expect(orderServiceItem(service({}), true).is_product).toBe(true)
  })

  it('clamps negative/null money to 0 and discount to [0, 999.99]', () => {
    const item = orderServiceItem(service({ price: null, lineAmount: -10, discount: 1500 }))
    expect(item.unit_price).toBe(0)
    expect(item.line_amount).toBe(0)
    expect(item.discount_percent).toBe(999.99)
  })
})

describe('enrichAmount (money-loss guard)', () => {
  it('uses the Agbis amount when it is positive', () => {
    expect(enrichAmount(order({ amount: 8500 }), 0)).toBe(8500)
    expect(enrichAmount(order({ amount: 8500 }), 3000)).toBe(8500)
  })

  it('PRESERVES the existing amount when Agbis kredit is null or zero (never downgrade to 0)', () => {
    expect(enrichAmount(order({ amount: null }), 8500)).toBe(8500)
    expect(enrichAmount(order({ amount: 0 }), 8500)).toBe(8500)
  })

  it('stays 0 when both are absent', () => {
    expect(enrichAmount(order({ amount: null }), 0)).toBe(0)
  })
})
