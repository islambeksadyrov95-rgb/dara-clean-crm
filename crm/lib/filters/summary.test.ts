import { describe, it, expect } from 'vitest'
import { summarizeCondition } from './summary'
import type { FilterFieldDef } from './types'

const managerField: FilterFieldDef = {
  key: 'assigned_manager',
  label: 'Ответственный',
  kind: 'multiselect',
  options: [
    { value: '__none__', label: 'Общая очередь' },
    { value: 'u1', label: 'Елена' },
  ],
}

describe('summarizeCondition', () => {
  it('text: shows the term', () => {
    expect(
      summarizeCondition({ key: 'name', label: 'Имя', kind: 'text' }, { field: 'name', op: 'contains', value: 'Айгуль' })
    ).toBe('Айгуль')
  })

  it('multiselect: maps values to labels', () => {
    expect(
      summarizeCondition(managerField, { field: 'assigned_manager', op: 'in', value: ['u1', '__none__'] })
    ).toBe('Елена, Общая очередь')
  })

  it('number range: from/to with unit', () => {
    const f: FilterFieldDef = { key: 'total_spent', label: 'Сумма', kind: 'number-range', unit: '₸' }
    expect(summarizeCondition(f, { field: 'total_spent', op: 'between', value: { from: '1000', to: '5000' } })).toBe('1000–5000 ₸')
    expect(summarizeCondition(f, { field: 'total_spent', op: 'between', value: { from: '1000' } })).toBe('от 1000 ₸')
    expect(summarizeCondition(f, { field: 'total_spent', op: 'between', value: { to: '5000' } })).toBe('до 5000 ₸')
  })

  it('date range: preset label or explicit dates', () => {
    const f: FilterFieldDef = { key: 'created_at', label: 'Добавлен', kind: 'date-range' }
    expect(summarizeCondition(f, { field: 'created_at', op: 'between', value: { preset: 'last30' } })).toBe('30 дней')
    expect(
      summarizeCondition(f, { field: 'created_at', op: 'between', value: { from: '2026-06-01', to: '2026-06-10' } })
    ).toBe('01.06.2026 – 10.06.2026')
  })
})
