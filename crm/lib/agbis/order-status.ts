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

// ── Отмена заказа ────────────────────────────────────────────────────────────
// Причина отмены = RETURN_KIND_ID в Agbis (вид возврата в DOC_ORDER_SERV_RETURNS),
// НЕ статус. Доказано рецептом отмены: docs/integrations/agbis-api/CANCEL-FEATURE-RND.md.
export const CANCEL_REASONS = [
  { id: 7, label: 'Отказ клиента от обработки' },
  { id: 8, label: 'Ошибка при оформлении' },
] as const

export type CancelReasonId = (typeof CANCEL_REASONS)[number]['id']

export function isValidCancelReason(id: number): id is CancelReasonId {
  return CANCEL_REASONS.some((reason) => reason.id === id)
}

// Отмена НЕ ходит по ALLOWED_TRANSITIONS: у Выданного(5) переходов нет, но отменить его
// можно, пока он не оплачен. На статус 5 заказ попадает уже при старте выдачи/доставки
// (создан выезд, проставлен date_out_fact) — ДО фактической передачи клиенту и оплаты,
// и в Agbis нет отдельного статуса «в доставке» vs «выдан». Поэтому ось безопасности
// отмены — НЕОПЛАЧЕН (DEBET=0), а не статус. Нельзя отменять только уже Отменённый(7)
// и неизвестный статус. Раздельный статус-чейнджер по-прежнему ходит по ALLOWED_TRANSITIONS.
const NON_CANCELLABLE_STATUS_IDS: AgbisStatusId[] = [7]

/** Можно ли отменить заказ: неоплачен И статус известен и не Отменённый. */
export function canCancelOrder(statusName: string | null, isUnpaid: boolean): boolean {
  const id = statusNameToId(statusName)
  return isUnpaid && id !== null && !NON_CANCELLABLE_STATUS_IDS.includes(id)
}
