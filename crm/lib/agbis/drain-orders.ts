import { createAdminClient } from '@/lib/supabase/admin'
import { pushOrderToAgbis } from './push-order'
import { pushTripForArm, type TripArm } from './push-trip'
import { TRIP_KINDS } from './order-trips'

/**
 * Drain queued CRM→Agbis writes (agbis_outbox) using the outbox state machine — NOT a blind retry.
 * Each row is atomically CLAIMED (claim_agbis_outbox: FOR UPDATE SKIP LOCKED, marks in_progress,
 * increments attempts) so concurrent drains never double-process a row, then pushed, then SETTLED
 * (settle_agbis_outbox): success → 'done'; failure → exponential backoff + 'error', or 'dead' once
 * attempts ≥ max_attempts (dead-letter for operator review — never retried forever). The order push
 * itself is idempotent (read-back before re-create), so a claimed-but-already-committed order is
 * recognised and marked synced rather than duplicated. Service role.
 */

export type DrainResult = { processed: number; synced: number; pending: number; dead: number }

const BACKOFF_BASE_SECONDS = 60
const BACKOFF_MAX_SECONDS = 6 * 60 * 60 // 6h cap

type ClaimedRow = { id: string; crm_id: string; payload: unknown; attempts: number; max_attempts: number }
type AdminClient = ReturnType<typeof createAdminClient>

/** Exponential backoff with jitter (seconds): 60, 120, 240, … capped at 6h. attempts is 1-based. */
export function backoffSeconds(attempts: number): number {
  const base = Math.min(BACKOFF_BASE_SECONDS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_SECONDS)
  return Math.round(base + Math.random() * base * 0.1)
}

/** Extract a string field from the JSON outbox payload safely (R9: typeof, not a cast). */
function strField(payload: unknown, key: string): string | undefined {
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

/** Intake warehouse (sclad_id) from the outbox payload. */
export function scladFromPayload(payload: unknown): string | undefined {
  return strField(payload, 'sclad_id')
}

/** Output warehouse (sclad_out_id) from the outbox payload; legacy rows have only sclad_id. */
export function scladOutFromPayload(payload: unknown): string | undefined {
  return strField(payload, 'sclad_out_id')
}

async function claim(admin: AdminClient, entity: 'order' | 'trip', limit: number): Promise<ClaimedRow[]> {
  const { data, error } = await admin.rpc('claim_agbis_outbox', {
    p_entity: entity,
    p_limit: limit,
    p_claimed_by: 'cron',
  })
  if (error) throw new Error('Не удалось захватить очередь Agbis')
  return (data ?? []) as ClaimedRow[]
}

async function settle(admin: AdminClient, row: ClaimedRow, ok: boolean, reason: string): Promise<boolean> {
  // Whether this failure exhausts the row (→ dead-letter). attempts was already incremented by claim.
  const willDie = !ok && row.attempts >= row.max_attempts
  await admin.rpc('settle_agbis_outbox', {
    p_id: row.id,
    p_success: ok,
    p_error: ok ? undefined : reason,
    p_backoff_seconds: backoffSeconds(row.attempts),
  })
  return willDie
}

export async function drainPendingOrders(limit = 50): Promise<DrainResult> {
  const admin = createAdminClient()
  const rows = await claim(admin, 'order', limit)

  let synced = 0
  let dead = 0
  for (const row of rows) {
    // Re-push with the FULL frozen context (intake date, manager, delivery, urgency) — not drain-day
    // defaults — so a recovered order is identical to its inline push (D-2026-06-28-enqueue-first).
    const res = await pushOrderToAgbis(row.crm_id, {
      scladId: scladFromPayload(row.payload),
      scladOutId: scladOutFromPayload(row.payload),
      managerEmail: strField(row.payload, 'manager_email') ?? null,
      docDate: strField(row.payload, 'doc_date'),
      dateOut: strField(row.payload, 'date_out') ?? null,
      fastExec: strField(row.payload, 'fast_exec') ?? null,
    })
    const ok = res.status === 'synced'
    if (ok) synced++
    if (await settle(admin, row, ok, ok ? '' : res.reason)) dead++
  }

  return { processed: rows.length, synced, pending: rows.length - synced - dead, dead }
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
 * Drain queued trip pushes (entity='trip'). Same claim→push→settle state machine as orders. Each
 * row is one arm (pickup/delivery). pushTripForArm is idempotent per arm (an arm already carrying
 * agbis_trip_id is a no-op) and enqueueOnFailure=false so a still-failing arm is NOT re-queued — the
 * settle backoff/dead-letter owns the retry schedule. A malformed payload is settled as a permanent
 * failure (reason 'malformed') so it backs off and eventually dead-letters instead of looping. Service role.
 */
export async function drainPendingTrips(limit = 50): Promise<DrainResult> {
  const admin = createAdminClient()
  const rows = await claim(admin, 'trip', limit)

  let synced = 0
  let dead = 0
  for (const row of rows) {
    const arm = tripArmFromPayload(row.payload)
    const res = arm ? await pushTripForArm(row.crm_id, arm, { enqueueOnFailure: false }) : { ok: false as const, reason: 'malformed' }
    if (res.ok) synced++
    if (await settle(admin, row, res.ok, res.ok ? '' : res.reason)) dead++
  }

  return { processed: rows.length, synced, pending: rows.length - synced - dead, dead }
}
