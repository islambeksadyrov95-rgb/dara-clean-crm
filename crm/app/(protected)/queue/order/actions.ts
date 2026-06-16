'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CreateOrderSchema, buildOrderItems, buildCarpetItems, sumLineAmounts, computeDiscount } from './order-build'
import { pushOrderToAgbis } from '@/lib/agbis/push-order'
import { pushTripForOrder } from '@/lib/agbis/push-trip'
import { tripsHr } from '@/lib/agbis/trips'
import type { CreateOrderInput } from './order-build'
import {
  almatyNowLocal,
  deliveryLocalToISO,
  intakeDateToAgbis,
  deliveryISOToAgbis,
} from '@/lib/agbis/order-dates'

/**
 * Create a CRM order and push it to Agbis (v1: fixed-price services + dates/urgency).
 * Commit-then-push: the order is written atomically via create_order_with_items (orders +
 * order_items + idempotent aggregate recompute), THEN local fulfillment fields (intake/delivery
 * date, urgency) are written by the service role (orders has no authenticated UPDATE policy),
 * THEN it is sent to Agbis. Failure/unlinked client → order kept (sync_status='pending') + queued.
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
        tripId: string | null
        createdAt: string
      }
    }
  | { success: false; error: string }

type Fulfillment = { intakeISO: string | null; deliveryISO: string | null; fastExecId: string | undefined }

/** Persist local-only fulfillment columns via the service role (deny-by-default UPDATE on orders). */
async function persistFulfillment(orderId: string, f: Fulfillment): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('orders')
    .update({
      intake_date: f.intakeISO,
      delivery_date: f.deliveryISO,
      fast_exec_id: f.fastExecId && f.fastExecId !== '0' ? Number(f.fastExecId) : null,
    })
    .eq('id', orderId)
}

/** Widest free trip window for (date, car): first→last free slot. null if Agbis returns no slots. */
async function widestTripWindow(date: string, carId: string): Promise<{ hr: string; hrTo: string } | null> {
  try {
    const slots = await tripsHr(date, carId)
    if (slots.length === 0) return null
    return { hr: slots[0], hrTo: slots.length > 1 ? slots[slots.length - 1] : slots[0] }
  } catch (err) {
    console.error('[order.tripWindow]', err)
    return null
  }
}

/**
 * Create the Agbis trip (выезд) for non-self orders. Trip failure does not fail the order.
 * Район и окно времени убраны из формы (D-2026-06-16): окно подставляется самым широким свободным
 * слотом дня, район в Agbis не передаётся.
 */
async function maybePushTrip(
  orderId: string,
  input: CreateOrderInput,
  intakeLocal: string,
  deliveryISO: string | null,
  managerEmail: string | null | undefined,
): Promise<string | null> {
  if (input.deliveryType === 'self') return null
  const dropoffDate = deliveryISO ? deliveryISOToAgbis(deliveryISO)?.split(' ')[0] : null
  const date = (input.deliveryType === 'dropoff' && dropoffDate) || intakeDateToAgbis(intakeLocal)
  if (!date || !input.deliveryAddress || !input.carId) return null
  const window = await widestTripWindow(date, input.carId)
  if (!window) return null
  const res = await pushTripForOrder(orderId, {
    type: input.deliveryType,
    date,
    hr: window.hr,
    hrTo: window.hrTo,
    carId: input.carId,
    address: input.deliveryAddress,
    comment: input.comment ?? null,
    managerEmail,
  })
  return res.ok ? res.tripId : null
}

export async function createOrder(rawInput: unknown): Promise<CreateOrderResult> {
  const parsed = CreateOrderSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { success: false, error: 'Проверьте позиции и склад заказа' }
  }
  const { clientId, items, carpets, scladId, comment, intakeDate, deliveryAt, fastExecId, discountPercent } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Не авторизован' }

  // Fixed services + carpets (carpet price = CRM estimate; Agbis stays authoritative — D1).
  // Order-level discount → per-service discount % (Agbis applies it to its authoritative price).
  const grossItems = [...buildOrderItems(items), ...buildCarpetItems(carpets)]
  const subtotal = sumLineAmounts(grossItems)
  const discount = computeDiscount(subtotal, discountPercent)
  const orderItems =
    discount.percent > 0 ? grossItems.map((it) => ({ ...it, discount_percent: discount.percent })) : grossItems
  const { data, error } = await supabase.rpc('create_order_with_items', {
    p_client_id: clientId,
    p_services: orderItems.map((it) => it.name),
    p_amount: subtotal,
    p_discount_percent: discount.percent,
    p_discount_amount: discount.amount,
    p_comment: comment ?? undefined,
    p_items: orderItems,
  })

  const order = data?.[0]
  if (error || !order) {
    console.error('[order.createOrder]', error)
    return { success: false, error: 'Не удалось создать заказ' }
  }

  const intakeLocal = intakeDate ?? almatyNowLocal()
  const intakeISO = deliveryLocalToISO(intakeLocal)
  const deliveryISO = deliveryAt ? deliveryLocalToISO(deliveryAt) : null
  await persistFulfillment(order.order_id, { intakeISO, deliveryISO, fastExecId })

  const push = await pushOrderToAgbis(order.order_id, {
    scladId,
    managerEmail: user.email,
    docDate: intakeDateToAgbis(intakeLocal) ?? undefined,
    dateOut: deliveryISO ? deliveryISOToAgbis(deliveryISO) : null,
    fastExec: fastExecId ?? null,
  })

  const tripId = await maybePushTrip(order.order_id, parsed.data, intakeLocal, deliveryISO, user.email)

  return {
    success: true,
    order: {
      id: order.order_id,
      amount: subtotal - discount.amount,
      agbisStatus: push.status,
      dorId: push.status === 'synced' ? push.dorId : null,
      tripId,
      createdAt: order.created_at,
    },
  }
}
