import { z } from 'zod'
import { agbisCall } from './client'
import { getValidSession } from './session'

/**
 * Agbis order reference lists for the order form: urgency (order_times), trip regions (Regions),
 * trip cars (Cars). Kept separate from commands.ts (read-sync stream owns that file). The list
 * endpoints need the SessionID in the query string. Each getter falls back gracefully on failure
 * so the form never breaks (R10 posture): urgency → a constant, regions/cars → [].
 */

export type OrderTimeOption = { id: string; name: string }
export type RegionOption = { id: string; name: string }
export type CarOption = { id: string; name: string }

export const DEFAULT_ORDER_TIMES: readonly OrderTimeOption[] = [{ id: '0', name: 'Не срочный' }] as const

const IdNameRow = z.object({ id: z.union([z.string(), z.number()]), name: z.string().min(1) })

/** Generic {id,name}[] extractor for a named array key in an Agbis list response. */
function parseIdNameList(res: unknown, key: string): { id: string; name: string }[] {
  const list = (res as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(list)) return []
  const out: { id: string; name: string }[] = []
  for (const row of list) {
    const parsed = IdNameRow.safeParse(row)
    if (parsed.success) out.push({ id: String(parsed.data.id), name: parsed.data.name.trim() })
  }
  return out
}

export function parseOrderTimes(res: unknown): OrderTimeOption[] {
  return parseIdNameList(res, 'ORDER_TIMES')
}

export function parseRegions(res: unknown): RegionOption[] {
  return parseIdNameList(res, 'regions')
}

export function parseCars(res: unknown): CarOption[] {
  return parseIdNameList(res, 'cars')
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

export async function getRegions(): Promise<RegionOption[]> {
  try {
    const sessionId = await getValidSession()
    return parseRegions(await agbisCall('Regions', { sessionId }))
  } catch (err) {
    console.error('[agbis.getRegions]', err)
    return []
  }
}

export async function getCars(): Promise<CarOption[]> {
  try {
    const sessionId = await getValidSession()
    return parseCars(await agbisCall('Cars', { sessionId }))
  } catch (err) {
    console.error('[agbis.getCars]', err)
    return []
  }
}
