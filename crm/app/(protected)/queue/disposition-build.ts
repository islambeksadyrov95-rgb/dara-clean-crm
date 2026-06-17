import { z } from 'zod'

/**
 * Pure validation + next-task computation for call dispositions. Lives outside actions.ts because a
 * 'use server' module may only export async functions. Реализует модель «звонок → задача»
 * (.planning/CALL-TASK-SYSTEM-SPEC-2026-06-18.md): каждый нетерминальный исход ставит
 * clients.next_action_at (очередь сама прячет клиента до срока и возвращает due-first), терминальный —
 * архивирует. Фикс невидимого +4ч-перезвона (раньше срок писался в невидимый call_log).
 */

export const CALL_STATUSES = ['reached', 'not_reached', 'callback', 'declined', 'not_relevant'] as const
export type CallStatus = (typeof CALL_STATUSES)[number]

export const CALL_SUB_STATUSES = [
  'ordered', 'callback_later',
  'decline_expensive', 'decline_competitor', 'decline_not_needed', 'decline_quality', 'decline_season', 'decline_other',
  'wrong_number', 'sent_whatsapp', 'unavailable', 'blocked', 'added_broadcast', 'auto_3_strikes',
] as const
export type CallSubStatus = (typeof CALL_SUB_STATUSES)[number]

/** Опциональный тег-причина на ПЕРЕЗВОНЕ — почему откладывает (для аналитики). На отказе причина = decline_* sub_status. */
export const CALLBACK_REASONS = ['думает', 'посоветуется', 'нет_денег', 'у_конкурента', 'не_сезон'] as const

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HM_RE = /^\d{2}:\d{2}$/

export const DispositionSchema = z
  .object({
    clientId: z.string().uuid(),
    status: z.enum(CALL_STATUSES),
    subStatus: z.enum(CALL_SUB_STATUSES).optional(),
    reason: z.string().max(300).optional(),
    nextCallDate: z.string().regex(YMD_RE).optional(),
    nextCallTime: z.string().regex(HM_RE).optional(),
    notes: z.string().max(1000).optional(),
    externalCallId: z.string().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    // Бизнес-правило (D-2026-06-18): отказ НЕЛЬЗЯ сохранить без причины — sub_status обязателен (decline_*).
    if (v.status === 'declined' && !v.subStatus) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subStatus'], message: 'Укажите причину отказа' })
    }
  })

export type DispositionInput = z.infer<typeof DispositionSchema>

// Каденс ретрая «не дозвонился» (D-2026-06-18): 1-я→+4ч, 2-я→+1д, 3-я→+3д, 4-я неудачная → авто-архив.
const RETRY_CADENCE_MS = [4 * 3600_000, 24 * 3600_000, 3 * 24 * 3600_000] as const
export const MAX_ATTEMPTS = RETRY_CADENCE_MS.length + 1 // 4 — на 4-й неудачной авто-архив (auto_3_strikes)
const DEFAULT_CALLBACK_MS = 2 * 24 * 3600_000 // дефолт перезвона = +2 дня (D-2026-06-18)
const ALMATY_OFFSET_MIN = 5 * 60 // UTC+5, без DST
const DEFAULT_CALLBACK_HOUR = '10:00'

/** Конкретные дата+время (Алматы, как ввёл менеджер) → UTC ISO для next_action_at. */
function almatyDateTimeToUtc(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - ALMATY_OFFSET_MIN * 60000).toISOString()
}

export type NextActionType = 'callback' | 'retry'
export type NextAction = { nextActionAt: string | null; nextActionType: NextActionType | null }

/**
 * Чистая функция: исход → следующая задача (next_action_at + тип). `attemptNumber` — № ТЕКУЩЕЙ
 * неудачной попытки (1 = первая). Перезвон: конкретное время или дефолт +2д. Не дозвонился
 * (unavailable): по каденсу. Остальные исходы задачу не планируют (терминал/заказ/whatsapp-касание).
 */
export function computeNextAction(p: {
  status: string
  subStatus?: string
  attemptNumber: number
  nowMs: number
  nextCallDate?: string
  nextCallTime?: string
}): NextAction {
  if (p.status === 'callback') {
    if (p.nextCallDate) {
      return { nextActionAt: almatyDateTimeToUtc(p.nextCallDate, p.nextCallTime || DEFAULT_CALLBACK_HOUR), nextActionType: 'callback' }
    }
    return { nextActionAt: new Date(p.nowMs + DEFAULT_CALLBACK_MS).toISOString(), nextActionType: 'callback' }
  }
  if (p.status === 'not_reached' && p.subStatus === 'unavailable') {
    const idx = Math.min(Math.max(p.attemptNumber - 1, 0), RETRY_CADENCE_MS.length - 1)
    return { nextActionAt: new Date(p.nowMs + RETRY_CADENCE_MS[idx]).toISOString(), nextActionType: 'retry' }
  }
  return { nextActionAt: null, nextActionType: null }
}

/** Терминальные (архивирующие) исходы. blocked теперь архивирует сразу (D-2026-06-18). */
export function isArchiving(status: string, subStatus?: string): boolean {
  return status === 'declined' || status === 'not_relevant' || subStatus === 'blocked'
}

/** Достигнут ли порог авто-архива по неудачным попыткам (3-strike → теперь 4). */
export function reachedAttemptLimit(attemptNumber: number): boolean {
  return attemptNumber >= MAX_ATTEMPTS
}
