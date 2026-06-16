import { z } from 'zod'
import { agbisCall } from './client'
import { getValidSession } from './session'

/**
 * Agbis trips (выезд) — free slots + create. Separate file (read-sync stream owns commands.ts).
 * Trip type: pickup (забрать грязные у клиента, tp=1) / dropoff (доставить чистые, tp=2);
 * самовывоз = no trip at all. TripsHr returns valid START hours for a (date, car); TripsHrTo is
 * unreliable (err105 across param variants, verified live 2026-06-16) so end-hour options are
 * derived client-side from the same list and Agbis validates the final window on TripOrder.
 * Pure builders/parsers are exported for unit tests; async fns add session + HTTP. Billed write.
 */

export type TripType = 'pickup' | 'dropoff'
export const TRIP_TP: Record<TripType, string> = { pickup: '1', dropoff: '2' }
const MP_STATUS_DEFAULT = '0'
/** mp_status — статус выезда (Agbis): 0 Новый · 2 Отменён (см. docs/04a-triporder). */
export const MP_STATUS_CANCELLED = '2'

export type TripOrderInput = {
  type: TripType
  date: string // dd.mm.yyyy
  hr: string // "11:00"
  hrTo: string // "12:00"
  carId: string
  address: string
  regionId?: string | null
  tel: string
  contrId?: string | null
  fio?: string | null
  comment?: string | null
  userId?: string | null
  id?: string | null // existing TripID — set to edit/cancel an Agbis trip instead of creating
  mpStatus?: string | null // override mp_status (e.g. MP_STATUS_CANCELLED to cancel)
}

export function parseTripSlots(res: unknown): string[] {
  const hr = (res as { hr?: unknown })?.hr
  if (!Array.isArray(hr)) return []
  return hr.filter((x): x is string => typeof x === 'string')
}

/** End-hour options for the form: slots strictly later than the chosen start (TripsHrTo is unusable). */
export function deriveEndOptions(slots: readonly string[], start: string): string[] {
  return slots.filter((s) => s > start)
}

export function buildTripOrderParams(input: TripOrderInput): Record<string, string> {
  const params: Record<string, string> = {
    tp: TRIP_TP[input.type],
    date: input.date,
    hr: input.hr,
    hr_to: input.hrTo,
    car_id: input.carId,
    address: input.address,
    tel: input.tel,
    mp_status: input.mpStatus ?? MP_STATUS_DEFAULT,
  }
  if (input.id) params.id = input.id // edit/cancel an existing trip
  if (input.regionId) params.region_id = input.regionId
  if (input.contrId) params.contr_id = input.contrId
  if (input.fio) params.fio = input.fio
  if (input.comment) params.comment = input.comment
  if (input.userId) params.user_id = input.userId
  return params
}

const TripOrderResponseSchema = z.object({ TripID: z.union([z.string(), z.number()]) })

export function parseTripOrderResponse(res: unknown): { tripId: string } {
  const parsed = TripOrderResponseSchema.safeParse(res)
  if (!parsed.success) throw new Error('Agbis: ответ TripOrder без TripID')
  return { tripId: String(parsed.data.TripID) }
}

/** Free start-hour slots for a (date, car). GET; session-scoped. */
export async function tripsHr(date: string, carId: string): Promise<string[]> {
  const sessionId = await getValidSession()
  const res = await agbisCall('TripsHr', { sessionId, params: { date, car_id: carId } })
  return parseTripSlots(res)
}

/** Create a trip in Agbis. GET with params (per API); returns the new TripID. Billed. */
export async function tripOrder(input: TripOrderInput): Promise<{ tripId: string }> {
  const sessionId = await getValidSession()
  const res = await agbisCall('TripOrder', { sessionId, params: buildTripOrderParams(input) })
  return parseTripOrderResponse(res)
}

export type TripWindow = { hr: string; hrTo: string }

/**
 * Widest free trip window for (date, car): first→last free slot (район/время убраны из формы —
 * Agbis всё равно валидирует окно на TripOrder). null if Agbis returns no slots or errors —
 * a non-fatal signal to the caller that this arm can't be scheduled now. Shared by order
 * creation and the outbox drain so a retried arm computes a fresh window.
 */
export async function widestTripWindow(date: string, carId: string): Promise<TripWindow | null> {
  try {
    const slots = await tripsHr(date, carId)
    if (slots.length === 0) return null
    return { hr: slots[0], hrTo: slots.length > 1 ? slots[slots.length - 1] : slots[0] }
  } catch (err) {
    console.error('[agbis.widestTripWindow]', err)
    return null
  }
}
