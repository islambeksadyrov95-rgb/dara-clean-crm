'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CreateOrderSchema, computeAmount, buildOrderItems } from './order-build'
import { pushOrderToAgbis } from '@/lib/agbis/push-order'
import { pushTripForOrder } from '@/lib/agbis/push-trip'
import type { CreateOrderInput } from './order-build'
import {
  almatyTodayYMD,
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

type Fulfillment = { intakeYMD: string; deliveryISO: string | null; fastExecId: string | undefined }

/** Persist local-only fulfillment columns via the service role (deny-by-default UPDATE on orders). */
async function persistFulfillment(orderId: string, f: Fulfillment): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('orders')
    .update({
      intake_date: f.intakeYMD,
      delivery_date: f.deliveryISO,
      fast_exec_id: f.fastExecId && f.fastExecId !== '0' ? Number(f.fastExecId) : null,
    })
    .eq('id', orderId)
}

/** Create the Agbis trip (выезд) for non-self orders. Trip failure does not fail the order. */
async function maybePushTrip(
  orderId: string,
  input: CreateOrderInput,
  intakeYMD: string,
  deliveryISO: string | null,
  managerEmail: string | null | undefined,
): Promise<string | null> {
  if (input.deliveryType === 'self') return null
  const dropoffDate = deliveryISO ? deliveryISOToAgbis(deliveryISO)?.split(' ')[0] : null
  const date = (input.deliveryType === 'dropoff' && dropoffDate) || intakeDateToAgbis(intakeYMD)
  if (!date || !input.deliveryAddress || !input.regionId || !input.carId || !input.tripHr || !input.tripHrTo) {
    return null
  }
  const res = await pushTripForOrder(orderId, {
    type: input.deliveryType,
    date,
    hr: input.tripHr,
    hrTo: input.tripHrTo,
    carId: input.carId,
    address: input.deliveryAddress,
    regionId: input.regionId,
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
  const { clientId, items, scladId, comment, intakeDate, deliveryAt, fastExecId } = parsed.data

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

  const intakeYMD = intakeDate ?? almatyTodayYMD()
  const deliveryISO = deliveryAt ? deliveryLocalToISO(deliveryAt) : null
  await persistFulfillment(order.order_id, { intakeYMD, deliveryISO, fastExecId })

  const push = await pushOrderToAgbis(order.order_id, {
    scladId,
    managerEmail: user.email,
    docDate: intakeDateToAgbis(intakeYMD) ?? undefined,
    dateOut: deliveryISO ? deliveryISOToAgbis(deliveryISO) : null,
    fastExec: fastExecId ?? null,
  })

  const tripId = await maybePushTrip(order.order_id, parsed.data, intakeYMD, deliveryISO, user.email)

  return {
    success: true,
    order: {
      id: order.order_id,
      amount,
      agbisStatus: push.status,
      dorId: push.status === 'synced' ? push.dorId : null,
      tripId,
      createdAt: order.created_at,
    },
  }
}
