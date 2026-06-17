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
