/**
 * Unified order-detail shape + pure normalizers for CRM orders ∪ imported order_history.
 * Lives outside the 'use server' loader (order-detail.ts) because a server-actions module may only
 * export async functions. Money is whole tenge. Both tables key on a uuid `id`.
 */

import { formatAlmatyDateTime } from '@/lib/agbis/order-dates'

export type OrderItemView = { name: string; qty: number; unitPrice: number; lineAmount: number }

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
  comment: string | null
  deliveryType: string | null
  address: string | null
  syncStatus: string | null
  receiver: string | null
  items: OrderItemView[]
}

type ClientName = { name: string } | null
export type CrmRow = {
  id: string; client_id: string; client: ClientName; manager_id: string
  agbis_doc_num: string | null; agbis_order_id: string | null; agbis_status_name: string | null
  amount: number; intake_date: string | null; delivery_date: string | null
  comment: string | null; delivery_type: string | null; delivery_address: string | null; sync_status: string | null
}
export type HistRow = {
  id: string; client_id: string; client: ClientName
  agbis_doc_num: string | null; agbis_dor_id: string | null; agbis_status_name: string | null
  amount: number; order_date: string; agbis_date_out: string | null
  agbis_user_name: string | null; address: string | null; service: string | null
}

export function normalizeCrmOrder(row: CrmRow, items: OrderItemView[], receiver: string | null): OrderDetail {
  return {
    source: 'crm', id: row.id, clientId: row.client_id, clientName: row.client?.name ?? null,
    docNum: row.agbis_doc_num, dorId: row.agbis_order_id, statusName: row.agbis_status_name,
    amount: row.amount, date: formatAlmatyDateTime(row.intake_date) ?? '', dateOut: formatAlmatyDateTime(row.delivery_date),
    comment: row.comment, deliveryType: row.delivery_type, address: row.delivery_address,
    syncStatus: row.sync_status, receiver, items,
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
    comment: null, deliveryType: null, address: row.address,
    syncStatus: null, receiver: row.agbis_user_name, items: items.length ? items : fallback,
  }
}

export type RawItem = { name: string; qty: number | null; unit_price: number; line_amount: number }
export const toItem = (r: RawItem): OrderItemView => ({
  name: r.name, qty: r.qty ?? 1, unitPrice: r.unit_price, lineAmount: r.line_amount,
})

export const CRM_COLS =
  'id, client_id, manager_id, agbis_doc_num, agbis_order_id, agbis_status_name, amount, intake_date, delivery_date, comment, delivery_type, delivery_address, sync_status, client:clients(name)'
export const HIST_COLS =
  'id, client_id, agbis_doc_num, agbis_dor_id, agbis_status_name, amount, order_date, agbis_date_out, agbis_user_name, address, service, client:clients(name)'
export const ITEM_COLS = 'name, qty, unit_price, line_amount'
