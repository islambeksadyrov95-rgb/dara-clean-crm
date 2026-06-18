// Единые подписи статусов/под-статусов звонков. Источник правды для UI (call-work-panel + calls/page).
// Раньше копия жила в двух местах и расходилась — теперь один модуль.

// Подписи верхнеуровневых статусов call_logs.
export const STATUS_LABELS: Record<string, string> = {
  reached: 'Дозвонился',
  not_reached: 'Не дозвонился',
  callback: 'Перезвонить',
  declined: 'Отказ',
  not_relevant: 'Не актуально',
  order: 'Заказ',
}

// Подписи под-статусов (sub_status) — причины/действия.
export const SUB_STATUS_LABELS: Record<string, string> = {
  ordered: 'Заказ',
  callback_later: 'Перезвон',
  sent_whatsapp: 'WhatsApp',
  added_broadcast: 'В рассылку',
  decline_expensive: 'Дорого',
  decline_competitor: 'Другая компания',
  decline_not_needed: 'Не нужно',
  decline_quality: 'Качество',
  decline_season: 'Не сезон',
  decline_other: 'Другое',
  wrong_number: 'Неверный номер',
  unavailable: 'Недоступен',
  blocked: 'Заблокировал',
  auto_3_strikes: '3 попытки',
}

// Объединённая карта для лукапа «sub_status ?? status» одной строкой (используется панелью истории).
export const CALL_LABELS: Record<string, string> = { ...STATUS_LABELS, ...SUB_STATUS_LABELS }

// Подпись для записи истории: приоритет под-статусу, затем статус, затем сырое значение.
export function callLabel(status: string, subStatus?: string | null): string {
  return (subStatus ? CALL_LABELS[subStatus] : undefined) ?? CALL_LABELS[status] ?? status
}

// ─── Причины контакта (унифицированный словарь) ───
// Канонические коды причины ПОСЛЕДНЕГО контакта. Источник правды для:
//   clients.last_call_reason (движок recordDisposition), фильтра «Причина» (client-fields),
//   тегов причины на перезвоне (call-work-panel) и CHECK-constraint в БД (миграция 20260618000001).
// Меняешь набор → синхронизируй CHECK в миграции и backfill.
export const CALL_REASONS: Record<string, string> = {
  expensive: 'Дорого',
  competitor: 'У конкурента',
  not_needed: 'Не нужно',
  quality: 'Качество',
  season: 'Не сезон',
  thinking: 'Думает',
  consulting: 'Посоветуется',
  no_money: 'Нет денег',
  other: 'Другое',
}

// Подмножество причин, доступных опц. тегом на ПЕРЕЗВОНЕ (на отказе причина = decline_* sub_status).
export const CALLBACK_REASON_CODES = ['thinking', 'consulting', 'no_money', 'competitor', 'season'] as const

// decline_* sub_status → канонический код причины (отказ несёт причину в sub_status, не в reason).
const DECLINE_SUBSTATUS_TO_REASON: Record<string, string> = {
  decline_expensive: 'expensive',
  decline_competitor: 'competitor',
  decline_not_needed: 'not_needed',
  decline_quality: 'quality',
  decline_season: 'season',
  decline_other: 'other',
}

/**
 * Каноническая причина ПОСЛЕДНЕГО контакта для clients.last_call_reason.
 * Отказ → код из decline_* sub_status (неизвестный decline → 'other'). Перезвон → тег-причина,
 * если задан валидный код. Прочие исходы (заказ/недозвон/whatsapp/неверный/заблокировал) → null.
 */
export function deriveLastCallReason(
  p: { status: string; subStatus?: string | null; reason?: string | null },
): string | null {
  if (p.status === 'declined') return p.subStatus ? (DECLINE_SUBSTATUS_TO_REASON[p.subStatus] ?? 'other') : 'other'
  if (p.status === 'callback' && p.reason && (CALLBACK_REASON_CODES as readonly string[]).includes(p.reason)) {
    return p.reason
  }
  return null
}

/** Подпись причины по канон. коду; fallback — сырое значение (старый free-text decline_other в call_logs.reason). */
export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return CALL_REASONS[code] ?? code
}
