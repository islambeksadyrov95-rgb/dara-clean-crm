import { createAdminClient } from '@/lib/supabase/admin'

// Все таблицы-логи интеграций — deny-by-default RLS. Чтение только через service role.
// Страницы вызывают эти функции ПОСЛЕ проверки роли admin (см. page.tsx).

export type Period = 'today' | 'month'

const ALMATY_OFFSET_MS = 5 * 3600 * 1000 // UTC+5, без DST
const RECENT_LIMIT = 50
const PERIOD_ROW_LIMIT = 10000

/** Начало периода в таймзоне Алматы (UTC+5), возвращает UTC ISO для фильтра created_at. */
export function periodStartIso(period: Period, nowMs: number): string {
  const a = new Date(nowMs + ALMATY_OFFSET_MS)
  const startLocalUtc =
    period === 'today'
      ? Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
      : Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)
  return new Date(startLocalUtc - ALMATY_OFFSET_MS).toISOString()
}

function countBy<T>(items: T[], key: (x: T) => string): { value: string; count: number }[] {
  const map = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
}

// ───────────────────────── Агбис ─────────────────────────

type AgbisAggRow = { command: string; billed: boolean; error_code: number | null; executed_api_count: number | null }
export type AgbisStats = {
  paid: number
  free: number
  total: number
  errors: number
  executedApiCount: number | null
  byCommand: { command: string; count: number }[]
}

export function aggregateAgbis(rows: AgbisAggRow[]): AgbisStats {
  const paidRows = rows.filter((r) => r.billed)
  const counts = rows.map((r) => r.executed_api_count).filter((n): n is number => typeof n === 'number')
  return {
    paid: paidRows.length,
    free: rows.length - paidRows.length,
    total: rows.length,
    errors: rows.filter((r) => r.error_code !== null).length,
    executedApiCount: counts.length ? Math.max(...counts) : null,
    byCommand: countBy(paidRows, (r) => r.command).map((c) => ({ command: c.value, count: c.count })),
  }
}

export type AgbisRecentRow = {
  id: string
  command: string
  billed: boolean
  error_code: number | null
  latency_ms: number | null
  agbis_dor_id: string | null
  created_at: string
}

export async function getAgbisStats(period: Period) {
  const admin = createAdminClient()
  const start = periodStartIso(period, Date.now())
  const { data: rows } = await admin
    .from('agbis_api_log')
    .select('command, billed, error_code, executed_api_count')
    .gte('created_at', start)
    .limit(PERIOD_ROW_LIMIT)
  const { data: recent } = await admin
    .from('agbis_api_log')
    .select('id, command, billed, error_code, latency_ms, agbis_dor_id, created_at')
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT)
  return { stats: aggregateAgbis(rows ?? []), recent: (recent ?? []) as AgbisRecentRow[] }
}

// ───────────────────────── Wazzup ─────────────────────────

type WazzupAggRow = { command: string; error_code: string | null }
export type WazzupStats = {
  total: number
  errors: number
  byCommand: { command: string; count: number }[]
}

export function aggregateWazzup(rows: WazzupAggRow[]): WazzupStats {
  return {
    total: rows.length,
    errors: rows.filter((r) => r.error_code !== null).length,
    byCommand: countBy(rows, (r) => r.command).map((c) => ({ command: c.value, count: c.count })),
  }
}

export type WazzupRecentRow = {
  id: string
  command: string
  direction: string
  chat_id: string | null
  error_code: string | null
  latency_ms: number | null
  created_at: string
}

export async function getWazzupStats(period: Period) {
  const admin = createAdminClient()
  const start = periodStartIso(period, Date.now())
  const { data: rows } = await admin
    .from('wazzup_api_log')
    .select('command, error_code')
    .gte('created_at', start)
    .limit(PERIOD_ROW_LIMIT)
  const { data: recent } = await admin
    .from('wazzup_api_log')
    .select('id, command, direction, chat_id, error_code, latency_ms, created_at')
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT)
  return { stats: aggregateWazzup(rows ?? []), recent: (recent ?? []) as WazzupRecentRow[] }
}

// ───────────────────────── Телефония ─────────────────────────

type TelephonyAggRow = { direction: string; is_recorded: boolean }
export type TelephonyStats = {
  total: number
  recorded: number
  events: number
  byDirection: { direction: string; count: number }[]
}

export function aggregateTelephony(calls: TelephonyAggRow[], events: number): TelephonyStats {
  return {
    total: calls.length,
    recorded: calls.filter((c) => c.is_recorded).length,
    events,
    byDirection: countBy(calls, (c) => c.direction).map((c) => ({ direction: c.value, count: c.count })),
  }
}

export type TelephonyRecentRow = {
  id: string
  direction: string
  number_a: string | null
  number_b: string | null
  duration: number
  is_recorded: boolean
  finish_status: string | null
  created_at: string
}

export async function getTelephonyStats(period: Period) {
  const admin = createAdminClient()
  const start = periodStartIso(period, Date.now())
  const { data: calls } = await admin
    .from('vpbx_calls')
    .select('direction, is_recorded')
    .gte('created_at', start)
    .limit(PERIOD_ROW_LIMIT)
  const { count: events } = await admin
    .from('vpbx_events')
    .select('event_id', { count: 'exact', head: true })
    .gte('received_at', start)
  const { data: recent } = await admin
    .from('vpbx_calls')
    .select('id, direction, number_a, number_b, duration, is_recorded, finish_status, created_at')
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT)
  return { stats: aggregateTelephony(calls ?? [], events ?? 0), recent: (recent ?? []) as TelephonyRecentRow[] }
}
