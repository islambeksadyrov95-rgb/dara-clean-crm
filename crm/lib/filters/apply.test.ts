import { describe, it, expect } from 'vitest'
import {
  validateConditions, applyClientConditions, needsSegmentsView,
  requiredEmbeds, broadcastNoOrderDays,
} from '@/lib/filters/apply'
import { daysAgoAlmaty } from '@/lib/filters/dates'
import type { FilterCondition } from '@/lib/filters/types'

// Стаб supabase-билдера: записывает вызовы, методы возвращают this.
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
    applyClientConditions(q, [{ field: 'name', op: 'contains', value: 'Ай%гуль' }])
    expect(q.calls).toEqual([{ method: 'ilike', args: ['name', '%Ай гуль%'] }])
  })

  it('days_since_last_order translates to inverted last_order_date range', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [
      { field: 'days_since_last_order', op: 'between', value: { from: '90', to: '180' } },
    ])
    // дней >= 90 — заказ не позже чем 90 дней назад; дней <= 180 — не раньше 180 дней назад
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

  it('call_ever never -> is null, has -> not is null', () => {
    const q1 = makeQueryStub()
    applyClientConditions(q1, [{ field: 'call_ever', op: 'in', value: ['never'] }])
    expect(q1.calls).toEqual([{ method: 'is', args: ['last_called_at', null] }])

    const q2 = makeQueryStub()
    applyClientConditions(q2, [{ field: 'call_ever', op: 'in', value: ['has'] }])
    expect(q2.calls).toEqual([{ method: 'not', args: ['last_called_at', 'is', null] }])
  })

  it('rfm_segment becomes in() and flags needsSegmentsView', () => {
    const q = makeQueryStub()
    const conds: FilterCondition[] = [{ field: 'rfm_segment', op: 'in', value: ['Потерянный'] }]
    applyClientConditions(q, conds)
    expect(q.calls).toEqual([{ method: 'in', args: ['rfm_segment', ['Потерянный']] }])
    expect(needsSegmentsView(conds)).toBe(true)
    expect(needsSegmentsView([{ field: 'name', op: 'contains', value: 'а' }])).toBe(false)
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

  it('tags filter targets embedded client_tags path and drops non-uuids', () => {
    const q = makeQueryStub()
    const id = '11111111-2222-3333-4444-555555555555'
    applyClientConditions(q, [{ field: 'tags', op: 'in', value: [id, 'not-a-uuid'] }])
    expect(q.calls).toEqual([{ method: 'in', args: ['client_tags.tag_id', [id]] }])
  })

  it('acquisition_source supports none + ids via or()', () => {
    const q = makeQueryStub()
    const id = '11111111-2222-3333-4444-555555555555'
    applyClientConditions(q, [{ field: 'acquisition_source', op: 'in', value: ['__none__', id] }])
    expect(q.calls).toEqual([
      { method: 'or', args: [`acquisition_source_id.is.null,acquisition_source_id.in.(${id})`] },
    ])
  })

  it('order_service and decline_reason filter embedded columns with sanitization', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [
      { field: 'order_service', op: 'in', value: ['Ковёр'] },
      { field: 'decline_reason', op: 'in', value: ['decline_expensive', 'DROP TABLE'] },
    ])
    expect(q.calls).toEqual([
      { method: 'in', args: ['order_history.service', ['Ковёр']] },
      { method: 'in', args: ['call_logs.sub_status', ['decline_expensive']] },
    ])
  })

  it('last_call_reason filters direct column and drops injection/garbage', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [{ field: 'last_call_reason', op: 'in', value: ['no_money', 'DROP TABLE'] }])
    expect(q.calls).toEqual([{ method: 'in', args: ['last_call_reason', ['no_money']] }])
  })

  it('last_call_reason requires no embed (direct column on clients/view)', () => {
    expect(requiredEmbeds([{ field: 'last_call_reason', op: 'in', value: ['expensive'] }])).toEqual([])
  })

  it('call_score range applies to embedded call_logs', () => {
    const q = makeQueryStub()
    applyClientConditions(q, [{ field: 'call_score', op: 'between', value: { to: '5' } }])
    expect(q.calls).toEqual([{ method: 'lte', args: ['call_logs.call_score', 5] }])
  })

  it('broadcast_no_order is skipped by sync builder and exposed via helper', () => {
    const q = makeQueryStub()
    const conds: FilterCondition[] = [{ field: 'broadcast_no_order', op: 'in', value: ['60'] }]
    applyClientConditions(q, conds)
    expect(q.calls).toEqual([])
    expect(broadcastNoOrderDays(conds)).toBe(60)
    expect(broadcastNoOrderDays([])).toBeNull()
  })

  it('requiredEmbeds returns unique embed strings for cross-entity fields', () => {
    const conds: FilterCondition[] = [
      { field: 'tags', op: 'in', value: ['11111111-2222-3333-4444-555555555555'] },
      { field: 'decline_reason', op: 'in', value: ['decline_expensive'] },
      { field: 'call_score', op: 'between', value: { to: '5' } },
      { field: 'name', op: 'contains', value: 'а' },
    ]
    expect(requiredEmbeds(conds)).toEqual(['client_tags!inner(tag_id)', 'call_logs!inner(id)'])
    expect(requiredEmbeds([{ field: 'name', op: 'contains', value: 'а' }])).toEqual([])
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
