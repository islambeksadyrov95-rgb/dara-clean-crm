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
