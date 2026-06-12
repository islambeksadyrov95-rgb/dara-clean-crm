import type { FilterCondition, FilterFieldDef, RangeValue } from './types'
import { DATE_PRESET_LABELS } from './types'

// Человекочитаемая сводка условия для чипа FilterBar: «Сегмент: Потерянный, В риске».

function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

function summarizeRange(value: RangeValue, unit: string | undefined, isDate: boolean): string {
  if (isDate && value.preset) return DATE_PRESET_LABELS[value.preset]
  const suffix = unit ? ` ${unit}` : ''
  const from = isDate && value.from ? formatIsoDate(value.from) : value.from
  const to = isDate && value.to ? formatIsoDate(value.to) : value.to
  if (from && to) return isDate ? `${from} – ${to}` : `${from}–${to}${suffix}`
  if (from) return isDate ? `с ${from}` : `от ${from}${suffix}`
  if (to) return isDate ? `по ${to}` : `до ${to}${suffix}`
  return ''
}

export function summarizeCondition(field: FilterFieldDef, condition: FilterCondition): string {
  if (typeof condition.value === 'string') return condition.value
  if (Array.isArray(condition.value)) {
    const byValue = new Map((field.options ?? []).map((o) => [o.value, o.label]))
    return condition.value.map((v) => byValue.get(v) ?? v).join(', ')
  }
  return summarizeRange(condition.value, field.unit, field.kind === 'date-range')
}
