import { createAdminClient } from '@/lib/supabase/admin'
import { tripOrder, widestTripWindow } from './trips'
import { getAgbisUserId } from './managers'
import { intakeDateToAgbis } from './order-dates'
import { TRIP_KIND_TO_TYPE, armAgbisDate, type TripKind } from './order-trips'

/**
 * CRM → Agbis trip (выезд) push for ONE arm of an order (pickup tp=1 / delivery tp=2). Separate
 * from the order push: an arm can be created/retried independently and an arm failure must never
 * lose the order. Source of truth is order_trips (one row per arm). Idempotent per arm: an arm
 * already carrying agbis_trip_id is left untouched. The trip date + free window are derived here
 * from the order's intake/delivery dates so the outbox drain can retry an arm without extra state.
 * Writes use the service role (order_trips has no authenticated write policy).
 */

type AdminClient = ReturnType<typeof createAdminClient>

export type TripArm = { kind: TripKind; address: string; carId: string }
export type TripPushResult = { ok: true; tripId: string } | { ok: false; reason: string }

type ArmContext = {
  tel: string | null
  contrId: string | null
  userId: string | null
  intakeYMD: string | null // "2026-06-16"
  deliveryISO: string | null
}

/** ISO date (YYYY-MM-DD) for the order_trips.trip_date column: pickup→intake, delivery→delivery. */
function armIsoDate(kind: TripKind, ctx: ArmContext): string | null {
  if (kind === 'delivery') return ctx.deliveryISO?.slice(0, 10) ?? ctx.intakeYMD
  return ctx.intakeYMD
}

async function loadArmContext(admin: AdminClient, orderId: string): Promise<ArmContext | null> {
  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, manager_id, intake_date, delivery_date')
    .eq('id', orderId)
    .maybeSingle()
  if (!order) return null
  const [{ data: client }, { data: mgr }] = await Promise.all([
    admin.from('clients').select('phone, agbis_client_id').eq('id', order.client_id).maybeSingle(),
    admin.from('profiles').select('email').eq('id', order.manager_id).maybeSingle(),
  ])
  return {
    tel: client?.phone ?? null,
    contrId: client?.agbis_client_id ?? null,
    userId: getAgbisUserId(mgr?.email),
    intakeYMD: order.intake_date,
    deliveryISO: order.delivery_date,
  }
}

async function saveArm(
  admin: AdminClient,
  orderId: string,
  arm: TripArm,
  isoDate: string | null,
  patch: { agbis_trip_id?: string; window_from?: string; window_to?: string; sync_status: string; sync_error: string | null },
): Promise<void> {
  await admin.from('order_trips').upsert(
    { order_id: orderId, kind: arm.kind, address: arm.address, agbis_car_id: arm.carId, trip_date: isoDate, updated_at: new Date().toISOString(), ...patch },
    { onConflict: 'order_id,kind' },
  )
}

async function enqueueTripRetry(admin: AdminClient, orderId: string, arm: TripArm): Promise<void> {
  await admin.from('agbis_outbox').insert({
    entity: 'trip',
    crm_id: orderId,
    op: 'create',
    payload: { kind: arm.kind, address: arm.address, car_id: arm.carId },
  })
}

async function failArm(
  admin: AdminClient,
  orderId: string,
  arm: TripArm,
  isoDate: string | null,
  reason: string,
  enqueue: boolean,
): Promise<TripPushResult> {
  await saveArm(admin, orderId, arm, isoDate, { sync_status: 'failed', sync_error: reason })
  if (enqueue) await enqueueTripRetry(admin, orderId, arm)
  return { ok: false, reason }
}

export async function pushTripForArm(
  orderId: string,
  arm: TripArm,
  opts: { enqueueOnFailure?: boolean } = {},
): Promise<TripPushResult> {
  const admin = createAdminClient()
  const enqueue = opts.enqueueOnFailure !== false

  const { data: existing } = await admin
    .from('order_trips').select('agbis_trip_id').eq('order_id', orderId).eq('kind', arm.kind).maybeSingle()
  if (existing?.agbis_trip_id) return { ok: true, tripId: existing.agbis_trip_id }

  const ctx = await loadArmContext(admin, orderId)
  if (!ctx) return { ok: false, reason: 'order_not_found' } // no parent → cannot write a child row
  const isoDate = armIsoDate(arm.kind, ctx)
  if (!ctx.tel) return failArm(admin, orderId, arm, isoDate, 'client_phone_missing', enqueue)

  const date = armAgbisDate(arm.kind, ctx.intakeYMD && intakeDateToAgbis(ctx.intakeYMD), ctx.deliveryISO && intakeDateToAgbis(ctx.deliveryISO))
  if (!date) return failArm(admin, orderId, arm, isoDate, 'no_date', enqueue)
  const window = await widestTripWindow(date, arm.carId)
  if (!window) return failArm(admin, orderId, arm, isoDate, 'no_slots', enqueue)

  try {
    const { tripId } = await tripOrder({
      type: TRIP_KIND_TO_TYPE[arm.kind], date, hr: window.hr, hrTo: window.hrTo,
      carId: arm.carId, address: arm.address, tel: ctx.tel, contrId: ctx.contrId, userId: ctx.userId,
    })
    await saveArm(admin, orderId, arm, isoDate, { agbis_trip_id: tripId, window_from: window.hr, window_to: window.hrTo, sync_status: 'synced', sync_error: null })
    return { ok: true, tripId }
  } catch (err) {
    console.error('[agbis.pushTripForArm]', err)
    return failArm(admin, orderId, arm, isoDate, 'trip_failed', enqueue)
  }
}
