import { createAdminClient } from '@/lib/supabase/admin'
import { tripOrder, widestTripWindow, MP_STATUS_CANCELLED } from './trips'
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
  agbisOrderId: string | null // dor_id — null = заказ ещё не в Агбисе (выезд создавать нельзя)
}

/** ISO date (YYYY-MM-DD) for the order_trips.trip_date column: pickup→intake, delivery→delivery. */
function armIsoDate(kind: TripKind, ctx: ArmContext): string | null {
  if (kind === 'delivery') return ctx.deliveryISO?.slice(0, 10) ?? ctx.intakeYMD
  return ctx.intakeYMD
}

async function loadArmContext(admin: AdminClient, orderId: string): Promise<ArmContext | null> {
  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, manager_id, intake_date, delivery_date, agbis_order_id')
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
    agbisOrderId: order.agbis_order_id ?? null,
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
  // Заказ ещё не в Агбисе → НЕ создаём выезд: его нельзя привязать к заказу (нет dor_id для
  // junction) и он повиснет сиротой у курьера. Откладываем (failed+outbox) до синка заказа.
  if (!ctx.agbisOrderId) return failArm(admin, orderId, arm, isoDate, 'order_not_synced', enqueue)
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

/* ── Edit path (Wave 2): a manager changes an order's arms after creation ─────────────────── */

export type DesiredArm = { mode: 'self' | 'trip'; address: string; carId: string }
export type ArmSyncResult =
  | { ok: true; status: 'created' | 'edited' | 'cancelled' | 'unchanged'; tripId?: string }
  | { ok: false; reason: string }

type TripRowState = {
  agbis_trip_id: string | null; address: string | null; agbis_car_id: string | null
  window_from: string | null; window_to: string | null; trip_date: string | null
}
const TRIP_ROW_COLS = 'agbis_trip_id, address, agbis_car_id, window_from, window_to, trip_date'

async function loadArmRow(admin: AdminClient, orderId: string, kind: TripKind): Promise<TripRowState | null> {
  const { data } = await admin.from('order_trips').select(TRIP_ROW_COLS).eq('order_id', orderId).eq('kind', kind).maybeSingle()
  return data ?? null
}

/** Cancel a synced trip in Agbis (mp_status=2, reusing its stored slot) and drop the row + any queued retry. */
async function cancelArmTrip(admin: AdminClient, orderId: string, kind: TripKind, row: TripRowState, ctx: ArmContext): Promise<ArmSyncResult> {
  if (row.agbis_trip_id && ctx.tel && row.trip_date && row.window_from && row.window_to && row.address && row.agbis_car_id) {
    try {
      await tripOrder({
        id: row.agbis_trip_id, mpStatus: MP_STATUS_CANCELLED, type: TRIP_KIND_TO_TYPE[kind],
        date: intakeDateToAgbis(row.trip_date) ?? '', hr: row.window_from, hrTo: row.window_to,
        carId: row.agbis_car_id, address: row.address, tel: ctx.tel, contrId: ctx.contrId, userId: ctx.userId,
      })
    } catch (err) {
      console.error('[agbis.cancelArmTrip]', err)
      return { ok: false, reason: 'cancel_failed' }
    }
  }
  await admin.from('order_trips').delete().eq('order_id', orderId).eq('kind', kind)
  await admin.from('agbis_outbox').delete().eq('entity', 'trip').eq('crm_id', orderId).eq('payload->>kind', kind)
  return { ok: true, status: 'cancelled' }
}

/** Edit a synced trip in Agbis (TripOrder id + mp_status 0) when address/car changed; re-derives the window. */
async function editArmTrip(admin: AdminClient, orderId: string, kind: TripKind, arm: TripArm, tripId: string, ctx: ArmContext): Promise<ArmSyncResult> {
  const isoDate = armIsoDate(kind, ctx)
  const date = armAgbisDate(kind, ctx.intakeYMD && intakeDateToAgbis(ctx.intakeYMD), ctx.deliveryISO && intakeDateToAgbis(ctx.deliveryISO))
  if (!ctx.tel || !date) return { ok: false, reason: 'no_date' }
  const window = await widestTripWindow(date, arm.carId)
  if (!window) return { ok: false, reason: 'no_slots' }
  try {
    await tripOrder({
      id: tripId, mpStatus: '0', type: TRIP_KIND_TO_TYPE[kind], date, hr: window.hr, hrTo: window.hrTo,
      carId: arm.carId, address: arm.address, tel: ctx.tel, contrId: ctx.contrId, userId: ctx.userId,
    })
    await saveArm(admin, orderId, arm, isoDate, { agbis_trip_id: tripId, window_from: window.hr, window_to: window.hrTo, sync_status: 'synced', sync_error: null })
    return { ok: true, status: 'edited', tripId }
  } catch (err) {
    console.error('[agbis.editArmTrip]', err)
    return { ok: false, reason: 'edit_failed' }
  }
}

/**
 * Reconcile ONE arm to a desired state (Wave 2 edit). self → cancel any existing trip + drop row;
 * trip → create (if none/unsynced) or edit (if synced and address/car changed) else unchanged.
 * Idempotent; service role. Caller (action) must have already authorized the user against the order.
 */
export async function syncArm(orderId: string, kind: TripKind, desired: DesiredArm): Promise<ArmSyncResult> {
  const admin = createAdminClient()
  const row = await loadArmRow(admin, orderId, kind)

  if (desired.mode === 'self') {
    if (!row) return { ok: true, status: 'unchanged' }
    const ctx = await loadArmContext(admin, orderId)
    if (!ctx) return { ok: false, reason: 'order_not_found' }
    return cancelArmTrip(admin, orderId, kind, row, ctx)
  }

  const arm: TripArm = { kind, address: desired.address, carId: desired.carId }
  if (!row || !row.agbis_trip_id) {
    const res = await pushTripForArm(orderId, arm)
    return res.ok ? { ok: true, status: 'created', tripId: res.tripId } : res
  }
  if (row.address === desired.address && row.agbis_car_id === desired.carId) {
    return { ok: true, status: 'unchanged', tripId: row.agbis_trip_id }
  }
  const ctx = await loadArmContext(admin, orderId)
  if (!ctx) return { ok: false, reason: 'order_not_found' }
  return editArmTrip(admin, orderId, kind, arm, row.agbis_trip_id, ctx)
}
