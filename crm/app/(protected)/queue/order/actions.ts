'use server'

import { createClient } from '@/lib/supabase/server'
import { CreateOrderSchema, computeAmount, buildOrderItems } from './order-build'
import { pushOrderToAgbis } from '@/lib/agbis/push-order'

/**
 * Create a CRM order and push it to Agbis (v1: fixed-price services).
 * Commit-then-push: the order is written atomically via create_order_with_items (orders +
 * order_items + idempotent aggregate recompute), THEN sent to Agbis. If the push fails or the
 * client is not yet linked, the order is kept (sync_status='pending') and queued — never lost.
 * Errors returned to the client are generic (R1); input is validated with Zod (R2).
 */

type CreateOrderResult =
  | {
      success: true
      order: {
        id: string
        amount: number
        agbisStatus: 'synced' | 'pending'
        dorId: string | null
        createdAt: string
      }
    }
  | { success: false; error: string }

export async function createOrder(rawInput: unknown): Promise<CreateOrderResult> {
  const parsed = CreateOrderSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { success: false, error: 'Проверьте позиции и склад заказа' }
  }
  const { clientId, items, scladId, comment } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Не авторизован' }

  const amount = computeAmount(items)
  const { data, error } = await supabase.rpc('create_order_with_items', {
    p_client_id: clientId,
    p_services: items.map((it) => it.name),
    p_amount: amount,
    p_discount_percent: 0,
    p_discount_amount: 0,
    p_comment: comment ?? undefined,
    p_items: buildOrderItems(items),
  })

  const order = data?.[0]
  if (error || !order) {
    console.error('[order.createOrder]', error)
    return { success: false, error: 'Не удалось создать заказ' }
  }

  const push = await pushOrderToAgbis(order.order_id, scladId)

  return {
    success: true,
    order: {
      id: order.order_id,
      amount,
      agbisStatus: push.status,
      dorId: push.status === 'synced' ? push.dorId : null,
      createdAt: order.created_at,
    },
  }
}
