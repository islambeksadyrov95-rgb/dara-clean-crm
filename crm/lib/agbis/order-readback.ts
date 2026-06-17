import { agbisCall } from './client'
import { getValidSession } from './session'

/**
 * Order read-back: SaveOrderForAll returns only dor_id, not the human doc_num (№) or the
 * Agbis-side status. We re-read a NARROW one-day window (OrderByDateTimeForAll, keyed by the
 * order's intake/doc date — NOT "today", since the manager may set a different intake date) and
 * find our dor_id. Best-effort: never throws (wide windows 504; a missed read-back just leaves
 * the read-sync stream to fill doc_num later). Separate file (commands.ts is the read-sync stream).
 */

export type OrderMirror = {
  docNum: string | null
  statusId: number | null
  statusName: string | null
  dateOutFact: string | null
}

type RawOrder = Record<string, unknown>

export function buildDayWindow(dateDDMMYYYY: string): { StartDate: string; StopDate: string } {
  return { StartDate: `${dateDDMMYYYY} 00:00`, StopDate: `${dateDDMMYYYY} 23:59` }
}

export function parseOrders(res: unknown): RawOrder[] {
  const orders = (res as { orders?: unknown })?.orders
  return Array.isArray(orders) ? (orders as RawOrder[]) : []
}

export function pickOrder(orders: readonly RawOrder[], dorId: string): RawOrder | null {
  return orders.find((o) => String(o.dor_id) === String(dorId)) ?? null
}

/**
 * Idempotency guard: among the day-window orders, return the NEWEST one belonging to a contragent
 * (highest dor_id — Agbis ids are monotonic, so the most-recently-created order for this client).
 * Used before a RE-push to detect an order that Agbis already committed but whose dor_id never
 * reached the CRM (commit-then-timeout). Residual race: this cannot distinguish two legitimately
 * distinct same-day orders for the same client — it returns the latest, which is the right choice
 * when the alternative is creating a duplicate real order.
 */
export function pickLatestOrderByContr(orders: readonly RawOrder[], contrId: string): RawOrder | null {
  const mine = orders.filter((o) => String(o.contr_id) === String(contrId))
  if (mine.length === 0) return null
  return mine.reduce((newest, o) => (Number(o.dor_id) > Number(newest.dor_id) ? o : newest))
}

export function mapOrderMirror(raw: RawOrder): OrderMirror {
  const str = (v: unknown) => (v == null || v === '' ? null : String(v))
  const statusId = str(raw.status_id)
  return {
    docNum: str(raw.doc_num),
    statusId: statusId == null ? null : Number(statusId),
    statusName: str(raw.status_name),
    dateOutFact: str(raw.date_out_fact),
  }
}

export async function readBackOrder(dorId: string, intakeDDMMYYYY: string): Promise<OrderMirror | null> {
  try {
    const sessionId = await getValidSession()
    const res = await agbisCall('OrderByDateTimeForAll', {
      method: 'POST',
      sessionId,
      body: buildDayWindow(intakeDDMMYYYY),
    })
    const raw = pickOrder(parseOrders(res), dorId)
    return raw ? mapOrderMirror(raw) : null
  } catch (err) {
    console.error('[agbis.readBackOrder]', err)
    return null
  }
}

/**
 * Pre-push idempotency check: does Agbis ALREADY hold an order for this contragent on docDate?
 * Returns the existing dor_id (+ doc_num/status) so the caller can mark the CRM order synced
 * instead of creating a second real order. Best-effort: throws-to-null is DELIBERATELY NOT used
 * here — a failed read-back must NOT be treated as "no order exists" (that would re-create the
 * duplicate we are guarding against). Instead it returns a discriminated result so the caller can
 * refuse to push when the check itself failed. docDate keys the same day window the order used.
 */
export type ExistingOrderProbe =
  | { ok: true; found: OrderMirror & { dorId: string } }
  | { ok: true; found: null }
  | { ok: false }

export async function findExistingOrderByContr(
  contrId: string,
  docDDMMYYYY: string,
): Promise<ExistingOrderProbe> {
  try {
    const sessionId = await getValidSession()
    const res = await agbisCall('OrderByDateTimeForAll', {
      method: 'POST',
      sessionId,
      body: buildDayWindow(docDDMMYYYY),
    })
    const raw = pickLatestOrderByContr(parseOrders(res), contrId)
    if (!raw) return { ok: true, found: null }
    return { ok: true, found: { ...mapOrderMirror(raw), dorId: String(raw.dor_id) } }
  } catch (err) {
    console.error('[agbis.findExistingOrderByContr]', err)
    return { ok: false }
  }
}
