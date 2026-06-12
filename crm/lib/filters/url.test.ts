import { describe, it, expect } from 'vitest'
import { serializeConditions, parseConditions } from '@/lib/filters/url'
import type { FilterCondition } from '@/lib/filters/types'

describe('url serialization', () => {
  it('round-trips conditions through serialize/parse', () => {
    const conds: FilterCondition[] = [
      { field: 'name', op: 'contains', value: 'РђР№РіСѓР»СЊ' },
      { field: 'total_orders', op: 'between', value: { from: '2', to: '5' } },
      { field: 'rfm_segment', op: 'in', value: ['РџРѕС‚РµСЂСЏРЅРЅС‹Р№', 'Р’ СЂРёСЃРєРµ'] },
    ]
    expect(parseConditions(serializeConditions(conds))).toEqual(conds)
  })

  it('serializes empty conditions to empty string', () => {
    expect(serializeConditions([])).toBe('')
  })

  it('returns [] for garbage, null and unknown fields', () => {
    expect(parseConditions(null)).toEqual([])
    expect(parseConditions('')).toEqual([])
    expect(parseConditions('not-json{{')).toEqual([])
    expect(parseConditions(JSON.stringify([{ field: 'hack', op: 'in', value: ['x'] }]))).toEqual([])
  })
})

