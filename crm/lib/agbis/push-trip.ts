import { createAdminClient } from '@/lib/supabase/admin'
import { tripOrder, type TripType } from './trips'
import { getAgbisUserId } from './managers'

/**
 * CRM → Agbis trip (выезд) push for an order. Separate from order push: a trip can be created/
 * retried independently and a trip failure must NOT lose the order (which already exists in CRM).
 * Idempotent: an order already carrying agbis_trip_id is left untouched. Mirror writes use the
 * service role (orders has no authenticated UPDATE policy). Client tel/contr_id come from the DB.
 */

export type TripRequest = {
  type: TripType
  date: string // dd.mm.yyyy
  hr: string // "11:00"
  hrTo: string // "12:00"
  carId: string
  address: string
  regionId: string
  comment?: string | null
  managerEmail?: string | null
}

export type TripPushResult = { ok: true; tripId: string } | { ok: false; reason: string }

export async function pushTripForOrder(orderId: string, req: TripRequest): Promise<TripPushResult> {
  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, agbis_trip_id')
    .eq('id', orderId)
    .single()
  if (!order) return { ok: false, reason: 'order_not_found' }
  if (order.agbis_trip_id) return { ok: true, tripId: order.agbis_trip_id }

  const { data: client } = await admin
    .from('clients')
    .select('phone, agbis_client_id')
    .eq('id', order.client_id)
    .single()
  if (!client?.phone) return { ok: false, reason: 'client_phone_missing' }

  try {
    const { tripId } = await tripOrder({
      type: req.type,
      date: req.date,
      hr: req.hr,
      hrTo: req.hrTo,
      carId: req.carId,
      address: req.address,
      regionId: req.regionId,
      tel: client.phone,
      contrId: client.agbis_client_id ?? null,
      comment: req.comment ?? null,
      userId: getAgbisUserId(req.managerEmail),
    })
    await admin
      .from('orders')
      .update({
        agbis_trip_id: tripId,
        delivery_type: req.type,
        delivery_address: req.address,
        region_id: req.regionId,
        agbis_car_id: req.carId,
        trip_window_from: req.hr,
        trip_window_to: req.hrTo,
      })
      .eq('id', orderId)
    return { ok: true, tripId }
  } catch (err) {
    console.error('[agbis.pushTrip]', err)
    return { ok: false, reason: 'trip_failed' }
  }
}
