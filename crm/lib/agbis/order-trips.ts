import type { TripType } from './trips'

/**
 * order_trips contract — two independent fulfillment arms of an order:
 *   pickup  (Забор,  Agbis TripOrder tp=1) — забрать грязные у клиента
 *   delivery(Выдача, Agbis TripOrder tp=2) — доставить чистые клиенту
 * Each arm is self|trip; only "trip" arms get an order_trips row (self = no row). order_trips is
 * the source of truth for выезды (the single-leg columns on orders were dropped in Wave 1).
 * Pure helpers only (unit-tested) — DB writes live in push-trip.ts.
 */

export type TripKind = 'pickup' | 'delivery'

export const TRIP_KINDS: readonly TripKind[] = ['pickup', 'delivery']

/** Arm → Agbis trip type. pickup→tp=1 (pickup), delivery→tp=2 (dropoff). */
export const TRIP_KIND_TO_TYPE: Record<TripKind, TripType> = { pickup: 'pickup', delivery: 'dropoff' }

export const TRIP_KIND_LABEL: Record<TripKind, string> = { pickup: 'Забор', delivery: 'Выдача' }

/**
 * Which order date drives the trip date for an arm (both as dd.mm.yyyy): a забор happens on the
 * intake date, a выдача on the delivery date (falling back to intake when выдача date is unset).
 */
export function armAgbisDate(
  kind: TripKind,
  intakeDate: string | null,
  deliveryDate: string | null,
): string | null {
  if (kind === 'delivery') return deliveryDate ?? intakeDate
  return intakeDate
}
