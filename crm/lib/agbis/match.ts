import type { AgbisSyncOrder } from './sync-types'

/**
 * Pure order-matching for the ENRICH import (no I/O — unit-tested in match.test.ts).
 *
 * Goal: recover Agbis order detail into the EXISTING order_history without wiping or
 * double-counting. For ONE client:
 * - resyncs — an Agbis order whose dor_id already sits on a history row → re-update that
 *   row (idempotent; the unique index on agbis_dor_id is the DB-level guard).
 * - enrich  — a not-yet-linked history row matched one-to-one by calendar date → fill it.
 * - inserts — an Agbis order with no row to claim → insert a fresh history row.
 * - skipped — an order with no parseable date (order_date is NOT NULL) → quarantine/log.
 * Surplus existing rows (more rows than Agbis orders on a date) are intentionally left
 * untouched — ENRICH never deletes.
 */

export type ExistingHistoryRow = {
  id: string
  orderDate: string // yyyy-mm-dd
  agbisDorId: string | null
}

export type MatchResult = {
  resyncs: { rowId: string; order: AgbisSyncOrder }[]
  enrich: { rowId: string; order: AgbisSyncOrder }[]
  inserts: AgbisSyncOrder[]
  skipped: { order: AgbisSyncOrder; reason: 'no_order_date' }[]
}

/** Deterministic ordering so re-runs and tests are stable. */
function byDateThenDor(a: AgbisSyncOrder, b: AgbisSyncOrder): number {
  const da = a.orderDate ?? ''
  const db = b.orderDate ?? ''
  if (da !== db) return da < db ? -1 : 1
  return a.dorId < b.dorId ? -1 : a.dorId > b.dorId ? 1 : 0
}

export function matchOrders(
  agbisOrders: AgbisSyncOrder[],
  existingRows: ExistingHistoryRow[],
): MatchResult {
  const result: MatchResult = { resyncs: [], enrich: [], inserts: [], skipped: [] }

  // Rows already linked to a dor_id — idempotency target keyed by dor_id.
  const rowByDorId = new Map<string, string>()
  // Un-enriched rows pooled by calendar date (FIFO claim, one-to-one).
  const freeRowsByDate = new Map<string, string[]>()
  for (const row of existingRows) {
    if (row.agbisDorId) {
      rowByDorId.set(row.agbisDorId, row.id)
    } else {
      const bucket = freeRowsByDate.get(row.orderDate)
      if (bucket) bucket.push(row.id)
      else freeRowsByDate.set(row.orderDate, [row.id])
    }
  }

  // Dedupe by dor_id (Agbis dor_id is unique; guards against accidental repeats in a batch).
  const seen = new Set<string>()
  const ordered = [...agbisOrders].sort(byDateThenDor)

  for (const order of ordered) {
    if (seen.has(order.dorId)) continue
    seen.add(order.dorId)

    const linkedRowId = rowByDorId.get(order.dorId)
    if (linkedRowId) {
      result.resyncs.push({ rowId: linkedRowId, order })
      continue
    }

    if (!order.orderDate) {
      result.skipped.push({ order, reason: 'no_order_date' })
      continue
    }

    const bucket = freeRowsByDate.get(order.orderDate)
    const claimed = bucket && bucket.length > 0 ? bucket.shift() : undefined
    if (claimed) {
      result.enrich.push({ rowId: claimed, order })
    } else {
      result.inserts.push(order)
    }
  }

  return result
}
