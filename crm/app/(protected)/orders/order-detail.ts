'use server'

import { createClient } from '@/lib/supabase/server'
import {
  normalizeCrmOrder, normalizeHistoryOrder, toItem, toTripView,
  CRM_COLS, HIST_COLS, ITEM_COLS, TRIP_COLS,
  type OrderDetail, type CrmRow, type HistRow, type TripRow,
} from './order-detail-shape'

/**
 * Unified order detail loader: CRM orders ∪ imported order_history, keyed by the row uuid (both
 * tables use uuid `id`). A /orders/[id] page first looks in orders (CRM-created), then in
 * order_history (imported). RLS-scoped (authenticated client). Errors are generic (R1).
 */

export async function getOrderDetail(
  id: string,
): Promise<{ success: true; data: OrderDetail } | { success: false; error: string }> {
  const supabase = await createClient()

  const { data: crm, error: crmErr } = await supabase
    .from('orders').select(CRM_COLS).eq('id', id).maybeSingle()
  if (crmErr) {
    console.error('[orders.getOrderDetail.crm]', crmErr)
    return { success: false, error: 'Не удалось загрузить заказ' }
  }
  if (crm) {
    const crmRow = crm as CrmRow
    // Приёмщик = менеджер-создатель (orders.manager_id → profiles). Выезды — оба плеча из order_trips.
    const [{ data: its }, { data: mgr }, { data: trips }] = await Promise.all([
      supabase.from('order_items').select(ITEM_COLS).eq('order_id', id),
      supabase.from('profiles').select('name, email').eq('id', crmRow.manager_id).maybeSingle(),
      supabase.from('order_trips').select(TRIP_COLS).eq('order_id', id),
    ])
    const receiver = mgr?.name || mgr?.email || null
    const tripViews = ((trips ?? []) as TripRow[]).map(toTripView)
    return { success: true, data: normalizeCrmOrder(crmRow, (its ?? []).map(toItem), receiver, tripViews) }
  }

  const { data: hist, error: histErr } = await supabase
    .from('order_history').select(HIST_COLS).eq('id', id).maybeSingle()
  if (histErr) {
    console.error('[orders.getOrderDetail.history]', histErr)
    return { success: false, error: 'Не удалось загрузить заказ' }
  }
  if (!hist) return { success: false, error: 'Заказ не найден' }

  const { data: its } = await supabase
    .from('order_history_items').select(ITEM_COLS).eq('order_history_id', id)
  return { success: true, data: normalizeHistoryOrder(hist as HistRow, (its ?? []).map(toItem)) }
}
