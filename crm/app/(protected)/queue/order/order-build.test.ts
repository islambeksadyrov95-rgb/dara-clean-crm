import { describe, it, expect } from 'vitest'
import { CreateOrderSchema, computeAmount, buildOrderItems } from './order-build'

const validItem = { tovarId: '102419', name: 'Одеяло', qty: 2, unitPrice: 5000 }

describe('CreateOrderSchema', () => {
  it('accepts a valid order', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      items: [validItem],
      scladId: '1023',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty items', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [], scladId: '1023',
    })
    expect(r.success).toBe(false)
  })

  it('accepts optional dates and urgency', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      items: [validItem], scladId: '1023',
      intakeDate: '2026-06-16', deliveryAt: '2026-06-18T14:30', fastExecId: '0',
    })
    expect(r.success).toBe(true)
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
    })
    expect(r.success && r.data.deliveryType).toBe('self')
  })

  it('rejects a выезд (pickup) without address/region/car/time', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '1023',
      deliveryType: 'pickup',
    })
    expect(r.success).toBe(false)
  })

  it('accepts a выезд (dropoff) with all trip fields', () => {
    const r = CreateOrderSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111', items: [validItem], scladId: '1023',
      deliveryType: 'dropoff', deliveryAddress: 'ул. Абая 1', regionId: '1039', carId: '1023',
      tripHr: '11:00', tripHrTo: '12:00',
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

describe('computeAmount', () => {
  it('sums qty * unitPrice across items', () => {
    expect(computeAmount([validItem, { tovarId: '2', name: 'X', qty: 1, unitPrice: 3000 }])).toBe(13000)
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
