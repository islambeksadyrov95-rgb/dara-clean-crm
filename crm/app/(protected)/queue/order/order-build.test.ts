import { describe, it, expect } from 'vitest'
import { CreateOrderSchema, buildOrderItems, buildCarpetItems, sumLineAmounts, computeDiscount } from './order-build'

const validCarpet = { typeStrId: '1002336', typeName: 'Иранский', pricePerM2: 1500, shapeFlt: '2', dim1: 2, dim2: 3 }

const validItem = { tovarId: '102419', name: 'Одеяло', qty: 2, unitPrice: 5000 }

describe('CreateOrderSchema', () => {
  it('accepts a valid order', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      items: [validItem],
      scladId: '1023',
      deliveryAt: '2026-06-18T14:30',
    })
    expect(r.success).toBe(true)
  })

  it('accepts an order without a delivery date (выдача опциональна)', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '1023',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty items AND empty carpets', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [], carpets: [], scladId: '1023',
    })
    expect(r.success).toBe(false)
  })

  it('accepts a carpet-only order', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [], carpets: [validCarpet], scladId: '1023',
      deliveryAt: '2026-06-18T14:30',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a carpet with zero area', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [],
      carpets: [{ ...validCarpet, dim2: 0 }], scladId: '1023',
    })
    expect(r.success).toBe(false)
  })

  it('accepts optional dates and urgency', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      items: [validItem], scladId: '1023',
      intakeDate: '2026-06-16T09:00', deliveryAt: '2026-06-18T14:30', fastExecId: '0',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a date-only intake (datetime required)', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      items: [validItem], scladId: '1023', intakeDate: '2026-06-16',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a malformed delivery datetime', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      items: [validItem], scladId: '1023', deliveryAt: '2026-06-18',
    })
    expect(r.success).toBe(false)
  })

  it('defaults to самовывоз (self) and needs no trip fields', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '1023',
      deliveryAt: '2026-06-18T14:30',
    })
    expect(r.success && r.data.deliveryType).toBe('self')
  })

  it('rejects a выезд (pickup) without address/car', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '1023',
      deliveryType: 'pickup',
    })
    expect(r.success).toBe(false)
  })

  it('accepts a выезд (dropoff) with address + car (район/время убраны)', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '1023',
      deliveryType: 'dropoff', deliveryAddress: 'ул. Абая 1', carId: '1023',
      deliveryAt: '2026-06-18T14:30',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown warehouse', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '999999',
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-positive quantity and non-integer price', () => {
    const base = { clientId: '11111111-1111-4111-8111-111111111111', scladId: '1023' }
    expect(CreateOrderSchema.safeParse({ ...base, items: [{ ...validItem, qty: 0 }] }).success).toBe(false)
    expect(CreateOrderSchema.safeParse({ ...base, items: [{ ...validItem, unitPrice: 1.5 }] }).success).toBe(false)
  })
})

describe('buildOrderItems', () => {
  it('maps to the RPC jsonb item shape with line_amount and kfx=1', () => {
    expect(buildOrderItems([validItem])).toEqual([
      {
        agbis_tovar_id: '102419', name: 'Одеяло', qty: 2, kfx: 1,
        unit_price: 5000, line_amount: 10000, discount_percent: 0,
      },
    ])
  })
})

describe('buildCarpetItems', () => {
  it('builds a carpet line: area as kfx, estimate as line_amount, addons attached', () => {
    expect(buildCarpetItems([validCarpet])).toEqual([
      {
        agbis_tovar_id: '100387', name: 'Ковер (Иранский, 6 м²)', qty: 1, kfx: 6,
        unit_price: 1500, line_amount: 9000, discount_percent: 0,
        addons: [
          { addon_id: '100241', values: '1002336' },
          { addon_id: '100242', values: '2|3|2|' },
        ],
      },
    ])
  })
})

describe('sumLineAmounts', () => {
  it('totals line amounts across fixed + carpet items', () => {
    const all = [...buildOrderItems([validItem]), ...buildCarpetItems([validCarpet])]
    expect(sumLineAmounts(all)).toBe(10000 + 9000)
  })
})

describe('computeDiscount', () => {
  it('percent mode: amount = round(subtotal * percent / 100)', () => {
    expect(computeDiscount(10000, 'percent', 10)).toEqual({ percent: 10, amount: 1000 })
    expect(computeDiscount(999, 'percent', 10)).toEqual({ percent: 10, amount: 100 }) // 99.9 → 100
  })
  it('percent mode: caps at 100%', () => {
    expect(computeDiscount(5000, 'percent', 150)).toEqual({ percent: 100, amount: 5000 })
  })
  it('amount mode: clamps to subtotal and derives integer percent', () => {
    expect(computeDiscount(10000, 'amount', 2500)).toEqual({ percent: 25, amount: 2500 })
    expect(computeDiscount(4000, 'amount', 9999)).toEqual({ percent: 100, amount: 4000 })
  })
  it('zero subtotal or zero value → no discount', () => {
    expect(computeDiscount(0, 'percent', 10)).toEqual({ percent: 0, amount: 0 })
    expect(computeDiscount(5000, 'amount', 0)).toEqual({ percent: 0, amount: 0 })
  })
})
