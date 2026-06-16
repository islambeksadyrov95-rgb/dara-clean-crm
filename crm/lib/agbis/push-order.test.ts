import { describe, it, expect } from 'vitest'
import { buildOrderServices, formatDocDate } from './push-order'

describe('buildOrderServices', () => {
  it('maps line items to Agbis services, dropping rows without a catalog id', () => {
    const services = buildOrderServices([
      { agbis_tovar_id: '102419', qty: 1, discount_percent: 0 },
      { agbis_tovar_id: null, qty: 3, discount_percent: 0 },
      { agbis_tovar_id: '102420', qty: 2, discount_percent: 10 },
    ])
    expect(services).toEqual([
      { tovarId: '102419', count: 1, discount: 0 },
      { tovarId: '102420', count: 2, discount: 10 },
    ])
  })

  it('returns empty when no item has a catalog id', () => {
    expect(buildOrderServices([{ agbis_tovar_id: null, qty: 1, discount_percent: 0 }])).toEqual([])
  })
})

describe('formatDocDate', () => {
  it('formats an Almaty date as dd.mm.yyyy', () => {
    // 2026-06-16T03:00:00Z == 08:00 Almaty (UTC+5) → 16.06.2026
    expect(formatDocDate(new Date('2026-06-16T03:00:00Z'))).toBe('16.06.2026')
  })

  it('rolls to the local day for late-UTC times', () => {
    // 2026-06-15T20:00:00Z == 01:00 Almaty next day → 16.06.2026
    expect(formatDocDate(new Date('2026-06-15T20:00:00Z'))).toBe('16.06.2026')
  })
})
