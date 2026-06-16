import { createAdminClient } from '@/lib/supabase/admin'
import { pushOrderToAgbis } from './push-order'
import { pushTripForArm, type TripArm } from './push-trip'
import { TRIP_KINDS } from './order-trips'

/**
 * Drain queued order pushes (agbis_outbox, entity='order'). For each row, re-run pushOrderToAgbis
 * — which now links/creates the client on demand (ensureClientInAgbis), so orders that went
 * pending because the client was not yet in Agbis get retried automatically. On success the outbox
 * row is removed; failures stay queued for the next run. Service role; idempotent (push is a no-op
 * if the order already has agbis_order_id).
 */

export type DrainResult = { processed: number; synced: number; pending: number }

/** Extract sclad_id from the JSON outbox payload safely (R9: typeof, not a cast). */
function scladFromPayload(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'sclad_id' in payload) {
    const value = (payload as Record<string, unknown>).sclad_id
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

export async function drainPendingOrders(limit = 50): Promise<DrainResult> {
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('agbis_outbox')
    .select('id, crm_id, payload')
    .eq('entity', 'order')
    .eq('op', 'create')
    .limit(limit)

  let synced = 0
  for (const row of rows ?? []) {
    const res = await pushOrderToAgbis(row.crm_id, { scladId: scladFromPayload(row.payload) })
    if (res.status === 'synced') {
      await admin.from('agbis_outbox').delete().eq('id', row.id)
      synced++
    }
  }

  const processed = rows?.length ?? 0
  return { processed, synced, pending: processed - synced }
}

/** Reconstruct a trip arm from an outbox payload (R9: typeof checks, not casts). null if malformed. */
function tripArmFromPayload(payload: unknown): TripArm | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (typeof p.kind !== 'string' || !(TRIP_KINDS as readonly string[]).includes(p.kind)) return null
  if (typeof p.address !== 'string' || typeof p.car_id !== 'string') return null
  return { kind: p.kind as TripArm['kind'], address: p.address, carId: p.car_id }
}

/**
 * Drain queued trip pushes (agbis_outbox, entity='trip'). Each row is one arm (pickup/delivery)
 * that failed at order-creation time; re-run pushTripForArm, which re-derives the date + a fresh
 * free window and is idempotent per arm. enqueueOnFailure=false so a still-failing arm is NOT
 * re-queued (the outbox row stays for the next run). Service role.
 */
export async function drainPendingTrips(limit = 50): Promise<DrainResult> {
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('agbis_outbox')
    .select('id, crm_id, payload')
    .eq('entity', 'trip')
    .eq('op', 'create')
    .limit(limit)

  let synced = 0
  for (const row of rows ?? []) {
    const arm = tripArmFromPayload(row.payload)
    if (!arm) continue
    const res = await pushTripForArm(row.crm_id, arm, { enqueueOnFailure: false })
    if (res.ok) {
      await admin.from('agbis_outbox').delete().eq('id', row.id)
      synced++
    }
  }

  const processed = rows?.length ?? 0
  return { processed, synced, pending: processed - synced }
}
