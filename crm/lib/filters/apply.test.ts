import { describe, it, expect } from 'vitest'
import { validateConditions, applyClientConditions, needsSegmentsView } from '@/lib/filters/apply'
import { daysAgoAlmaty } from '@/lib/filters/dates'
import type { FilterCondition } from '@/lib/filters/types'

// РЎС‚Р°Р± supabase-Р±РёР»РґРµСЂР°: Р·Р°РїРёСЃС‹РІР°РµС‚ РІС‹Р·РѕРІС‹, РјРµС‚РѕРґС‹ РІРѕР·РІСЂР°С‰Р°СЋС‚ this.
function makeQueryStub() {
  const calls: { method: string; args: unknown[] }[] = []
  return {
    calls,
    ilike(...args: unknown[]) { calls.push({ method: 'ilike', args }); return this },
    in(...args: unknown[]) { calls.push({ method: 'in', args }); return this },
    is(...args: unknown[]) { calls.push({ method: 'is', args }); return this },
    not(...args: unknown[]) { calls.push({ method: 'not', args }); return this },
    gte(...args: unknown[]) { calls.push({ method: 'gte', args }); return this },
    lte(...args: unknown[]) { calls.push({ method: 'lte', args }); return this },
    or(...args: unknown[]) { calls.push({ method: 'or', args }); return this },
  }
}

describe('validateConditions', () => {
  it('accepts known fields and rejects unknown ones', () => {
    expect(validateConditions([{ field: 'phone', op: 'contains', value: '7707' }])).toHaveLength(1)
    expect(validateConditions([{ field: 'evil_column', op: 'contains', value: 'x' }])).toEqual([])
  })

  it('rejects non-array input', () => {
    expect(validateConditions('nope')).toEqual([])
    expect(validateConditions(undefined)).toEqual([])
  })
})

describe('applyClientConditions', () => {
  it('text condition becomes ilike with sanitized pattern', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [{ field: 'name', op: 'contains', value: 'РђР№%РіСѓР»СЊ' }])
    expect(q.calls).toEqual([{ method: 'ilike', args: ['name', '%РђР№ РіСѓР»СЊ%'] }])
  })

  it('days_since_last_order translates to inverted last_order_date range', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [
      { field: 'days_since_last_order', op: 'between', value: { from: '90', to: '180' } },
    ])
    // РґРЅРµР№ >= 90 в‡’ Р·Р°РєР°Р· РЅРµ РїРѕР·Р¶Рµ С‡РµРј 90 РґРЅРµР№ РЅР°Р·Р°Рґ; РґРЅРµР№ <= 180 в‡’ РЅРµ СЂР°РЅСЊС€Рµ 180 РґРЅРµР№ РЅР°Р·Р°Рґ
    expect(q.calls).toEqual([
      { method: 'lte', args: ['last_order_date', daysAgoAlmaty(90)] },
      { method: 'gte', args: ['last_order_date', daysAgoAlmaty(180)] },
    ])
  })

  it('manager filter with none + ids becomes or(is.null, in)', () => {
    const q = makeQueryStub()
    const id = '11111111-2222-3333-4444-555555555555'
    applyClientConditions(q, [{ field: 'assigned_manager', op: 'in', value: ['__none__', id] }])
    expect(q.calls).toEqual([
      { method: 'or', args: [`assigned_manager_id.is.null,assigned_manager_id.in.(${id})`] },
    ])
  })

  it('manager filter with only none becomes is null', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [{ field: 'assigned_manager', op: 'in', value: ['__none__'] }])
    expect(q.calls).toEqual([{ method: 'is', args: ['assigned_manager_id', null] }])
  })

  it('call_ever never в†’ is null, has в†’ not is null', () => {
    const q1 = makeQueryStub()
    applyClientConditions(q1, [{ field: 'call_ever', op: 'in', value: ['never'] }])
    expect(q1.calls).toEqual([{ method: 'is', args: ['last_called_at', null] }])

    const q2 = makeQueryStub()
    applyClientConditions(q2, [{ field: 'call_ever', op: 'in', value: ['has'] }])
    expect(q2.calls).toEqual([{ method: 'not', args: ['last_called_at', 'is', null] }])
  })

  it('rfm_segment becomes in() and flags needsSegmentsView', () => {
    const q = makeQueryStub()
    const conds: FilterCondition[] = [{ field: 'rfm_segment', op: 'in', value: ['РџРѕС‚РµСЂСЏРЅРЅС‹Р№'] }]
    applyClientConditions(q, conds)
    expect(q.calls).toEqual([{ method: 'in', args: ['rfm_segment', ['РџРѕС‚РµСЂСЏРЅРЅС‹Р№']] }])
    expect(needsSegmentsView(conds)).toBe(true)
    expect(needsSegmentsView([{ field: 'name', op: 'contains', value: 'Р°' }])).toBe(false)
  })

  it('number range applies gte/lte and skips non-numeric bounds', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [
      { field: 'total_spent', op: 'between', value: { from: '10000', to: 'abc' } },
    ])
    expect(q.calls).toEqual([{ method: 'gte', args: ['total_spent', 10000] }])
  })

  it('next_action multiselect combines via or()', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [{ field: 'next_action', op: 'in', value: ['overdue', 'none'] }])
    expect(q.calls).toHaveLength(1)
    expect(q.calls[0].method).toBe('or')
    const arg = String(q.calls[0].args[0])
    expect(arg).toContain('next_action_at.is.null')
    expect(arg).toContain('next_action_at.lte.')
  })

  it('date range on timestamptz column expands to Almaty day bounds', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [
      { field: 'created_at', op: 'between', value: { from: '2026-06-01', to: '2026-06-10' } },
    ])
    expect(q.calls).toEqual([
      { method: 'gte', args: ['created_at', '2026-06-01T00:00:00+05:00'] },
      { method: 'lte', args: ['created_at', '2026-06-10T23:59:59+05:00'] },
    ])
  })
})

