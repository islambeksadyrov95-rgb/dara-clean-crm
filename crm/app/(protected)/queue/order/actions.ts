'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CreateOrderSchema, UpdateOrderTripsSchema, buildOrderItems, buildCarpetItems, sumLineAmounts, computeDiscount } from './order-build'
import { pushOrderToAgbis } from '@/lib/agbis/push-order'
import { pushTripForArm, syncArm } from '@/lib/agbis/push-trip'
import { TRIP_KINDS } from '@/lib/agbis/order-trips'
import { getCars, type CarOption } from '@/lib/agbis/order-lists'
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
        tripIds: string[]
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

/**
 * Push the Agbis trip (выезд) for each arm that is a выезд (mode='trip'). Both arms are
 * independent: a failed arm does not fail the other arm nor the order — it is marked failed and
 * enqueued to the outbox for the cron to retry. pushTripForArm derives the trip date (забор=приём,
 * выдача=выдача) + the widest free window itself from the already-persisted order, so no dates are
 * threaded here. Район в Agbis не передаётся (D-2026-06-16). Returns the synced trip ids.
 */
async function maybePushTrips(orderId: string, input: CreateOrderInput): Promise<string[]> {
  const tripIds: string[] = []
  for (const kind of TRIP_KINDS) {
    const arm = input[kind]
    if (arm.mode !== 'trip' || !arm.address || !arm.carId) continue
    const res = await pushTripForArm(orderId, { kind, address: arm.address, carId: arm.carId })
    if (res.ok) tripIds.push(res.tripId)
  }
  return tripIds
}

export async function createOrder(rawInput: unknown): Promise<CreateOrderResult> {
  const parsed = CreateOrderSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { success: false, error: 'Проверьте позиции и склад заказа' }
  }
  const { clientId, items, carpets, scladId, scladOutId, comment, intakeDate, deliveryAt, fastExecId, discountPercent } = parsed.data

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
    scladOutId,
    managerEmail: user.email,
    docDate: intakeDateToAgbis(intakeLocal) ?? undefined,
    dateOut: deliveryISO ? deliveryISOToAgbis(deliveryISO) : null,
    fastExec: fastExecId ?? null,
  })

  const tripIds = await maybePushTrips(order.order_id, parsed.data)

  return {
    success: true,
    order: {
      id: order.order_id,
      amount: subtotal - discount.amount,
      agbisStatus: push.status,
      dorId: push.status === 'synced' ? push.dorId : null,
      tripIds,
      createdAt: order.created_at,
    },
  }
}

type TripCarsResult = { success: true; cars: readonly CarOption[] } | { success: false; error: string }

/**
 * Lightweight lookup for the выезд-edit form: ONLY the trip cars (one Agbis call). Avoids loading the
 * full order catalog (services + urgency + carpet options) that getOrderFormData pulls — the выезд form
 * needs nothing but the car dropdown. getCars already falls back to [] on failure (R10). Errors generic (R1).
 */
export async function getTripCars(): Promise<TripCarsResult> {
  try {
    return { success: true, cars: await getCars() }
  } catch (err) {
    console.error('[order.getTripCars]', err)
    return { success: false, error: 'Не удалось загрузить список машин' }
  }
}

type UpdateTripsResult = { success: true; tripIds: string[] } | { success: false; error: string }

/**
 * Wave 2 — edit an existing CRM order's trip arms (Забор/Выдача) after creation: fill самовывоз→выезд,
 * change address/car, or cancel a выезд. Ownership is enforced via RLS: the authed client can only
 * SELECT its own orders (manager) or all (admin), so a found order means the user is authorized
 * (IDOR guard). Each arm is reconciled by syncArm (create/edit/cancel in Agbis). Errors are generic (R1).
 */
export async function updateOrderTrips(rawInput: unknown): Promise<UpdateTripsResult> {
  const parsed = UpdateOrderTripsSchema.safeParse(rawInput)
  if (!parsed.success) return { success: false, error: 'Проверьте адреса выездов' }
  const { orderId } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Не авторизован' }

  const { data: order } = await supabase.from('orders').select('id').eq('id', orderId).maybeSingle()
  if (!order) return { success: false, error: 'Заказ не найден' }

  // Persist edited dates first (service role) so syncArm re-derives the delivery trip on the new date.
  const datePatch: { intake_date?: string | null; delivery_date?: string | null } = {}
  if (parsed.data.intakeDate) datePatch.intake_date = deliveryLocalToISO(parsed.data.intakeDate)
  if (parsed.data.deliveryAt) datePatch.delivery_date = deliveryLocalToISO(parsed.data.deliveryAt)
  if (Object.keys(datePatch).length) await createAdminClient().from('orders').update(datePatch).eq('id', orderId)

  const tripIds: string[] = []
  let failed = false
  for (const kind of TRIP_KINDS) {
    const arm = parsed.data[kind]
    const res = await syncArm(orderId, kind, { mode: arm.mode, address: arm.address ?? '', carId: arm.carId ?? '' })
    if (!res.ok) failed = true
    else if (res.tripId) tripIds.push(res.tripId)
  }
  if (failed) return { success: false, error: 'Не удалось обновить часть выездов' }
  return { success: true, tripIds }
}
