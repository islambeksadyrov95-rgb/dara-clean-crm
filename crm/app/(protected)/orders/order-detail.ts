'use server'

import { createClient } from '@/lib/supabase/server'
import {
  normalizeCrmOrder, normalizeHistoryOrder, toItem,
  CRM_COLS, HIST_COLS, ITEM_COLS,
  type OrderDetail, type CrmRow, type HistRow,
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
    const { data: its } = await supabase.from('order_items').select(ITEM_COLS).eq('order_id', id)
    return { success: true, data: normalizeCrmOrder(crm as CrmRow, (its ?? []).map(toItem)) }
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
