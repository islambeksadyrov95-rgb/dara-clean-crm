import { conditionsSchema, type FilterCondition, type RangeValue } from './types'
import { CLIENT_FILTER_FIELD_KEYS, MANAGER_NONE } from './client-fields'
import { resolveDateRange, daysAgoAlmaty } from './dates'

// Транслирует условия FilterBar в вызовы supabase-билдера (PostgREST).
// Работает и с таблицей clients, и с view client_segments — все используемые
// колонки есть в обоих источниках (view расширен миграцией 20260612000006).
// Исключение: rfm_segment есть только во view — caller маршрутизирует через needsSegmentsView().

/** Минимальный структурный интерфейс supabase-билдера — для тестируемости без сети. */
export interface FilterableQuery {
  ilike(column: string, pattern: string): unknown
  in(column: string, values: string[]): unknown
  is(column: string, value: null): unknown
  not(column: string, operator: string, value: unknown): unknown
  gte(column: string, value: string | number): unknown
  lte(column: string, value: string | number): unknown
  or(filters: string): unknown
}

const TEXT_COLUMNS: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  address: 'address',
  sticky_note: 'sticky_note',
}

const NUMBER_COLUMNS: Record<string, string> = {
  total_orders: 'total_orders',
  total_spent: 'total_spent',
  avg_order_value: 'avg_order_value',
}

// date-колонки: plain — тип date (сравнение по YYYY-MM-DD), ts — timestamptz
// (границы дня в Алматы, иначе фильтр «за сегодня» теряет утренние записи).
const DATE_COLUMNS: Record<string, { column: string; ts: boolean }> = {
  last_order_date: { column: 'last_order_date', ts: false },
  created_at: { column: 'created_at', ts: true },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** %, _ ломают ilike-паттерн; запятые и скобки ломают or()-строки PostgREST. */
function sanitizeText(value: string): string {
  return value.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim()
}

function asRange(value: FilterCondition['value']): RangeValue | null {
  return typeof value === 'object' && !Array.isArray(value) && value !== null ? value : null
}

function asValues(value: FilterCondition['value']): string[] {
  return Array.isArray(value) ? value : []
}

/** Валидация условий на границе server action: схема + whitelist полей. */
export function validateConditions(input: unknown): FilterCondition[] {
  const parsed = conditionsSchema.safeParse(input)
  if (!parsed.success) return []
  return parsed.data.filter((c) => CLIENT_FILTER_FIELD_KEYS.has(c.field))
}

/** true, если условия требуют view client_segments (вычисляемый rfm_segment). */
export function needsSegmentsView(conditions: FilterCondition[]): boolean {
  return conditions.some((c) => c.field === 'rfm_segment')
}

// ─── Кросс-сущностные условия (EXISTS через PostgREST embed !inner) ───

const EMBED_BY_FIELD: Record<string, string> = {
  tags: 'client_tags!inner(tag_id)',
  order_service: 'order_history!inner(id)',
  decline_reason: 'call_logs!inner(id)',
  call_score: 'call_logs!inner(id)',
}

/** Embed-строки для select — без них PostgREST не применит фильтры по связанным таблицам. */
export function requiredEmbeds(conditions: FilterCondition[]): string[] {
  const embeds = conditions
    .map((c) => EMBED_BY_FIELD[c.field])
    .filter((e): e is string => Boolean(e))
  return [...new Set(embeds)]
}

/**
 * «Получил рассылку, но не заказал»: NOT EXISTS не выражается фильтрами PostgREST,
 * caller разрешает асинхронно через RPC broadcast_no_order_ids(p_days) → .in('id', ids).
 */
export function broadcastNoOrderDays(conditions: FilterCondition[]): number | null {
  const cond = conditions.find((c) => c.field === 'broadcast_no_order')
  if (!cond) return null
  const days = asValues(cond.value).map(Number).filter(Number.isFinite)
  return days.length > 0 ? Math.max(...days) : null
}

/** Безопасный «пустой результат»: .in('id', [EMPTY_RESULT_UUID]) гарантированно ничего не вернёт. */
export const EMPTY_RESULT_UUID = '00000000-0000-0000-0000-000000000000'

function applyNumberRange(q: FilterableQuery, column: string, range: RangeValue): void {
  const from = Number(range.from)
  const to = Number(range.to)
  if (range.from !== undefined && range.from !== '' && Number.isFinite(from)) q.gte(column, from)
  if (range.to !== undefined && range.to !== '' && Number.isFinite(to)) q.lte(column, to)
}

function applyDateRange(q: FilterableQuery, column: string, ts: boolean, range: RangeValue): void {
  const { from, to } = resolveDateRange(range)
  if (from) q.gte(column, ts ? `${from}T00:00:00+05:00` : from)
  if (to) q.lte(column, ts ? `${to}T23:59:59+05:00` : to)
}

/** дней-с-события ≥ N ⇔ дата события ≤ N дней назад (и наоборот). */
function applyDaysSince(q: FilterableQuery, column: string, range: RangeValue, ts: boolean): void {
  const minDays = Number(range.from)
  const maxDays = Number(range.to)
  const bound = (days: number) => (ts ? `${daysAgoAlmaty(days)}T23:59:59+05:00` : daysAgoAlmaty(days))
  if (range.from !== undefined && range.from !== '' && Number.isFinite(minDays)) q.lte(column, bound(minDays))
  if (range.to !== undefined && range.to !== '' && Number.isFinite(maxDays)) q.gte(column, bound(maxDays))
}

function applyManager(q: FilterableQuery, values: string[]): void {
  const ids = values.filter((v) => UUID_RE.test(v))
  const wantsNone = values.includes(MANAGER_NONE)
  if (wantsNone && ids.length > 0) {
    q.or(`assigned_manager_id.is.null,assigned_manager_id.in.(${ids.join(',')})`)
  } else if (wantsNone) {
    q.is('assigned_manager_id', null)
  } else if (ids.length > 0) {
    q.in('assigned_manager_id', ids)
  }
}

function applyCallEver(q: FilterableQuery, values: string[]): void {
  const never = values.includes('never')
  const has = values.includes('has')
  if (never && !has) q.is('last_called_at', null)
  else if (has && !never) q.not('last_called_at', 'is', null)
  // оба значения = «все клиенты» — условие не сужает выборку
}

function applyNextAction(q: FilterableQuery, values: string[]): void {
  const nowIso = new Date().toISOString()
  const parts: string[] = []
  if (values.includes('overdue')) parts.push(`next_action_at.lte.${nowIso}`)
  if (values.includes('planned')) parts.push(`next_action_at.gt.${nowIso}`)
  if (values.includes('none')) parts.push('next_action_at.is.null')
  if (parts.length === 1) {
    if (values.includes('none') && parts[0] === 'next_action_at.is.null') q.is('next_action_at', null)
    else if (values.includes('overdue')) q.lte('next_action_at', nowIso)
    else q.gte('next_action_at', nowIso)
  } else if (parts.length > 1) {
    q.or(parts.join(','))
  }
}

/** Применяет условия к запросу. Условия комбинируются по AND. */
export function applyClientConditions<Q extends FilterableQuery>(q: Q, conditions: FilterCondition[]): Q {
  for (const c of conditions) {
    const range = asRange(c.value)
    if (c.field in TEXT_COLUMNS && typeof c.value === 'string') {
      const term = sanitizeText(c.value)
      if (term) q.ilike(TEXT_COLUMNS[c.field], `%${term}%`)
    } else if (c.field in NUMBER_COLUMNS && range) {
      applyNumberRange(q, NUMBER_COLUMNS[c.field], range)
    } else if (c.field in DATE_COLUMNS && range) {
      applyDateRange(q, DATE_COLUMNS[c.field].column, DATE_COLUMNS[c.field].ts, range)
    } else if (c.field === 'days_since_last_order' && range) {
      applyDaysSince(q, 'last_order_date', range, false)
    } else if (c.field === 'days_since_last_call' && range) {
      applyDaysSince(q, 'last_called_at', range, true)
    } else if (c.field === 'assigned_manager') {
      applyManager(q, asValues(c.value))
    } else if (c.field === 'call_ever') {
      applyCallEver(q, asValues(c.value))
    } else if (c.field === 'next_action') {
      applyNextAction(q, asValues(c.value))
    } else if (c.field === 'rfm_segment') {
      const values = asValues(c.value).filter(Boolean)
      if (values.length > 0) q.in('rfm_segment', values)
    } else if (c.field === 'tags') {
      const ids = asValues(c.value).filter((v) => UUID_RE.test(v))
      if (ids.length > 0) q.in('client_tags.tag_id', ids)
    } else if (c.field === 'acquisition_source') {
      applySourceFilter(q, asValues(c.value))
    } else if (c.field === 'order_service') {
      const services = asValues(c.value).map(sanitizeText).filter(Boolean)
      if (services.length > 0) q.in('order_history.service', services)
    } else if (c.field === 'decline_reason') {
      // Только snake_case-коды sub_status — мусор и инъекции отбрасываются.
      const reasons = asValues(c.value).filter((v) => /^[a-z0-9_]+$/.test(v))
      if (reasons.length > 0) q.in('call_logs.sub_status', reasons)
    } else if (c.field === 'call_score' && range) {
      applyNumberRange(q, 'call_logs.call_score', range)
    }
    // broadcast_no_order разрешается асинхронно caller'ом (см. broadcastNoOrderDays)
  }
  return q
}

function applySourceFilter(q: FilterableQuery, values: string[]): void {
  const ids = values.filter((v) => UUID_RE.test(v))
  const wantsNone = values.includes(MANAGER_NONE)
  if (wantsNone && ids.length > 0) {
    q.or(`acquisition_source_id.is.null,acquisition_source_id.in.(${ids.join(',')})`)
  } else if (wantsNone) {
    q.is('acquisition_source_id', null)
  } else if (ids.length > 0) {
    q.in('acquisition_source_id', ids)
  }
}
