/**
 * Unified order-detail shape + pure normalizers for CRM orders ∪ imported order_history.
 * Lives outside the 'use server' loader (order-detail.ts) because a server-actions module may only
 * export async functions. Money is whole tenge. Both tables key on a uuid `id`.
 */

import { formatAlmatyDateTime, isoToAlmatyInput } from '@/lib/agbis/order-dates'
import type { TripKind } from '@/lib/agbis/order-trips'

export type OrderItemView = { name: string; qty: number; unitPrice: number; lineAmount: number }

/** One trip arm of a CRM order (from order_trips). Source of truth for выезды (Wave 1). */
export type TripView = { kind: TripKind; address: string; carId: string | null; syncStatus: string | null; tripId: string | null; boundAt: string | null }

export type OrderDetail = {
  source: 'crm' | 'history'
  id: string
  clientId: string
  clientName: string | null
  docNum: string | null
  dorId: string | null
  statusName: string | null
  amount: number
  date: string
  dateOut: string | null
  intakeAt: string | null // raw "YYYY-MM-DDTHH:mm" (Almaty) for the edit form; CRM only
  deliveryAt: string | null // raw "YYYY-MM-DDTHH:mm" (Almaty) for the edit form; CRM only
  comment: string | null
  address: string | null // legacy single address (imported order_history only)
  trips: TripView[] // CRM order arms (Забор/Выдача); empty for самовывоз / history
  syncStatus: string | null
  receiver: string | null
  items: OrderItemView[]
  // Отмена заказа (CRM only). isUnpaid из agbis_debet (зеркало с лагом) — UI прячет кнопку при
  // оплате; агент авторитетно перепроверяет живой DEBET. cancelledAt — отметка исполнения агентом.
  isUnpaid: boolean
  cancelRequested: boolean
  cancelReason: number | null // RETURN_KIND_ID 7/8
  cancelledAt: string | null
}

type ClientName = { name: string } | null
export type CrmRow = {
  id: string; client_id: string; client: ClientName; manager_id: string
  agbis_doc_num: string | null; agbis_order_id: string | null; agbis_status_name: string | null
  amount: number; intake_date: string | null; delivery_date: string | null
  comment: string | null; sync_status: string | null; agbis_debet: number | null
  cancel_requested: boolean; cancel_reason: number | null; cancelled_at: string | null
}
export type TripRow = {
  kind: TripKind; address: string; agbis_car_id: string | null; agbis_trip_id: string | null; sync_status: string | null; bound_at: string | null
}
export const toTripView = (r: TripRow): TripView => ({
  kind: r.kind, address: r.address, carId: r.agbis_car_id, syncStatus: r.sync_status, tripId: r.agbis_trip_id, boundAt: r.bound_at,
})
export type HistRow = {
  id: string; client_id: string; client: ClientName
  agbis_doc_num: string | null; agbis_dor_id: string | null; agbis_status_name: string | null
  amount: number; order_date: string; agbis_date_out: string | null
  agbis_user_name: string | null; address: string | null; service: string | null
}

export function normalizeCrmOrder(
  row: CrmRow, items: OrderItemView[], receiver: string | null, trips: TripView[],
): OrderDetail {
  return {
    source: 'crm', id: row.id, clientId: row.client_id, clientName: row.client?.name ?? null,
    docNum: row.agbis_doc_num, dorId: row.agbis_order_id, statusName: row.agbis_status_name,
    amount: row.amount, date: formatAlmatyDateTime(row.intake_date) ?? '', dateOut: formatAlmatyDateTime(row.delivery_date),
    intakeAt: isoToAlmatyInput(row.intake_date), deliveryAt: isoToAlmatyInput(row.delivery_date),
    comment: row.comment, address: null, trips,
    syncStatus: row.sync_status, receiver, items,
    isUnpaid: row.agbis_debet === null || row.agbis_debet === 0,
    cancelRequested: row.cancel_requested, cancelReason: row.cancel_reason, cancelledAt: row.cancelled_at,
  }
}

export function normalizeHistoryOrder(row: HistRow, items: OrderItemView[]): OrderDetail {
  const fallback: OrderItemView[] = row.service
    ? [{ name: row.service, qty: 1, unitPrice: row.amount, lineAmount: row.amount }]
    : []
  return {
    source: 'history', id: row.id, clientId: row.client_id, clientName: row.client?.name ?? null,
    docNum: row.agbis_doc_num, dorId: row.agbis_dor_id, statusName: row.agbis_status_name,
    amount: row.amount, date: row.order_date, dateOut: row.agbis_date_out,
    intakeAt: null, deliveryAt: null,
    comment: null, address: row.address, trips: [],
    syncStatus: null, receiver: row.agbis_user_name, items: items.length ? items : fallback,
    isUnpaid: false, cancelRequested: false, cancelReason: null, cancelledAt: null,
  }
}

export type RawItem = { name: string; qty: number | null; unit_price: number; line_amount: number }
export const toItem = (r: RawItem): OrderItemView => ({
  name: r.name, qty: r.qty ?? 1, unitPrice: r.unit_price, lineAmount: r.line_amount,
})

export const CRM_COLS =
  'id, client_id, manager_id, agbis_doc_num, agbis_order_id, agbis_status_name, amount, intake_date, delivery_date, comment, sync_status, agbis_debet, cancel_requested, cancel_reason, cancelled_at, client:clients(name)'
export const TRIP_COLS = 'kind, address, agbis_car_id, agbis_trip_id, sync_status, bound_at'
export const HIST_COLS =
  'id, client_id, agbis_doc_num, agbis_dor_id, agbis_status_name, amount, order_date, agbis_date_out, agbis_user_name, address, service, client:clients(name)'
export const ITEM_COLS = 'name, qty, unit_price, line_amount'
