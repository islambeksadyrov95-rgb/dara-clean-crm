import type { FilterCondition } from './types'
import { validateConditions } from './apply'

// Сериализация условий фильтра в URL-параметр (?f=...). JSON + encodeURIComponent:
// фильтр можно скинуть коллеге ссылкой, F5 не сбрасывает состояние.

export function serializeConditions(conditions: FilterCondition[]): string {
  if (conditions.length === 0) return ''
  return encodeURIComponent(JSON.stringify(conditions))
}

/** Мусор, чужие поля и битый JSON молча превращаются в пустой фильтр. */
export function parseConditions(raw: string | null): FilterCondition[] {
  if (!raw) return []
  try {
    return validateConditions(JSON.parse(decodeURIComponent(raw)))
  } catch {
    return []
  }
}
