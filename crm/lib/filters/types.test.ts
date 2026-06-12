import { describe, it, expect } from 'vitest'
import { conditionsSchema, DEFAULT_OP } from '@/lib/filters/types'

describe('conditionsSchema', () => {
  it('accepts valid conditions of each value shape', () => {
    const res = conditionsSchema.safeParse([
      { field: 'name', op: 'contains', value: 'РђР№РіСѓР»СЊ' },
      { field: 'rfm_segment', op: 'in', value: ['РџРѕС‚РµСЂСЏРЅРЅС‹Р№', 'Р’ СЂРёСЃРєРµ'] },
      { field: 'total_orders', op: 'between', value: { from: '2', to: '5' } },
      { field: 'last_order_date', op: 'between', value: { preset: 'last30' } },
    ])
    expect(res.success).toBe(true)
  })

  it('rejects unknown op and oversized payloads', () => {
    expect(conditionsSchema.safeParse([{ field: 'name', op: 'regex', value: 'x' }]).success).toBe(false)
    expect(conditionsSchema.safeParse([{ field: 'name', op: 'contains', value: 'x'.repeat(201) }]).success).toBe(false)
  })

  it('DEFAULT_OP maps every field kind', () => {
    expect(DEFAULT_OP.text).toBe('contains')
    expect(DEFAULT_OP.multiselect).toBe('in')
    expect(DEFAULT_OP['number-range']).toBe('between')
    expect(DEFAULT_OP['date-range']).toBe('between')
  })
})

