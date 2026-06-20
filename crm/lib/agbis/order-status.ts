/**
 * Agbis order status state machine. Статусы и их id — из 05-commercial-session.md §enum (запись):
 * 1 Новый · 3 В исполнении · 4 Исполненный · 5 Выданный · 7 Отменённый. Чистый модуль (без 'use server')
 * — переиспользуется сервером (actions) и клиентом (карточка заказа), покрыт unit-тестами.
 */

export const AGBIS_STATUS = {
  1: 'Новый',
  3: 'В исполнении',
  4: 'Исполненный',
  5: 'Выданный',
  7: 'Отменённый',
} as const

export type AgbisStatusId = keyof typeof AGBIS_STATUS
export type AgbisStatusName = (typeof AGBIS_STATUS)[AgbisStatusId]

// Обратный маппинг имя→id (явно, чтобы не кастовать Object.keys).
export const STATUS_NAME_TO_ID: Record<string, AgbisStatusId> = {
  Новый: 1,
  'В исполнении': 3,
  Исполненный: 4,
  Выданный: 5,
  Отменённый: 7,
}

// Разрешённые переходы (state machine): прямой поток химчистки + отмена из любого активного.
// Терминальные статусы (Выданный, Отменённый) переходов не имеют. Дефолт бизнес-правила —
// единственный источник правды переходов; при изменении бизнес-логики править здесь.
export const ALLOWED_TRANSITIONS: Record<AgbisStatusId, AgbisStatusId[]> = {
  1: [3, 7],
  3: [4, 7],
  4: [5, 7],
  5: [],
  7: [],
}

export function statusNameToId(name: string | null): AgbisStatusId | null {
  if (!name) return null
  return STATUS_NAME_TO_ID[name] ?? null
}

export function isValidStatusId(id: number): id is AgbisStatusId {
  return id in AGBIS_STATUS
}

/** Разрешён ли переход из текущего статуса (по имени) в целевой id. */
export function isTransitionAllowed(fromName: string | null, toId: number): boolean {
  const fromId = statusNameToId(fromName)
  if (fromId === null || !isValidStatusId(toId)) return false
  return ALLOWED_TRANSITIONS[fromId].includes(toId)
}

/** Список допустимых следующих статусов для UI (id + имя). Пусто для терминальных/неизвестных. */
export function allowedNextStatuses(fromName: string | null): { id: AgbisStatusId; name: string }[] {
  const fromId = statusNameToId(fromName)
  if (fromId === null) return []
  return ALLOWED_TRANSITIONS[fromId].map((id) => ({ id, name: AGBIS_STATUS[id] }))
}
