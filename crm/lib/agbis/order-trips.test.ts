import { describe, it, expect } from 'vitest'
import { TRIP_KINDS, TRIP_KIND_TO_TYPE, TRIP_KIND_LABEL, armAgbisDate } from './order-trips'

describe('order-trips contract', () => {
  it('maps arm kind to Agbis trip type (pickup=tp1, delivery=tp2)', () => {
    expect(TRIP_KIND_TO_TYPE.pickup).toBe('pickup')
    expect(TRIP_KIND_TO_TYPE.delivery).toBe('dropoff')
  })

  it('exposes both arms with Russian labels', () => {
    expect(TRIP_KINDS).toEqual(['pickup', 'delivery'])
    expect(TRIP_KIND_LABEL.pickup).toBe('Забор')
    expect(TRIP_KIND_LABEL.delivery).toBe('Выдача')
  })
})

describe('armAgbisDate', () => {
  it('pickup uses the intake date', () => {
    expect(armAgbisDate('pickup', '16.06.2026', '18.06.2026')).toBe('16.06.2026')
  })

  it('delivery uses the delivery date', () => {
    expect(armAgbisDate('delivery', '16.06.2026', '18.06.2026')).toBe('18.06.2026')
  })

  it('delivery falls back to intake when no delivery date', () => {
    expect(armAgbisDate('delivery', '16.06.2026', null)).toBe('16.06.2026')
  })

  it('returns null when no usable date', () => {
    expect(armAgbisDate('pickup', null, '18.06.2026')).toBeNull()
    expect(armAgbisDate('delivery', null, null)).toBeNull()
  })
})
