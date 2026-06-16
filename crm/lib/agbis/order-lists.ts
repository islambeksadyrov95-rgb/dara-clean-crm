import { z } from 'zod'
import { agbisCall } from './client'
import { getValidSession } from './session'

/**
 * Agbis order reference lists used by the order form (urgency / order_times). Kept separate from
 * commands.ts (read-sync stream owns that file). GetListsOrderTNDForAll needs the SessionID in the
 * query string. Urgency is a tiny, stable list (live: only «Не срочный»); on any failure we fall
 * back to a constant so the form never breaks (R10 posture).
 */

export type OrderTimeOption = { id: string; name: string }

export const DEFAULT_ORDER_TIMES: readonly OrderTimeOption[] = [{ id: '0', name: 'Не срочный' }] as const

const OrderTimeRow = z.object({ id: z.union([z.string(), z.number()]), name: z.string().min(1) })

export function parseOrderTimes(res: unknown): OrderTimeOption[] {
  const list = (res as { ORDER_TIMES?: unknown })?.ORDER_TIMES
  if (!Array.isArray(list)) return []
  const out: OrderTimeOption[] = []
  for (const row of list) {
    const parsed = OrderTimeRow.safeParse(row)
    if (parsed.success) out.push({ id: String(parsed.data.id), name: parsed.data.name })
  }
  return out
}

export async function getOrderTimes(): Promise<readonly OrderTimeOption[]> {
  try {
    const sessionId = await getValidSession()
    const res = await agbisCall('GetListsOrderTNDForAll', { sessionId })
    const options = parseOrderTimes(res)
    return options.length ? options : DEFAULT_ORDER_TIMES
  } catch (err) {
    console.error('[agbis.getOrderTimes]', err)
    return DEFAULT_ORDER_TIMES
  }
}
