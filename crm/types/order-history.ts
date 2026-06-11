// Shared contract for Phase 1 (order history). Source: EXECUTION-PLAN-2026-06-11.
// amount is INTEGER whole tenge (Invariants §Money in .planning/REGISTRY.md).

export interface OrderHistoryRow {
  id: string
  client_id: string
  order_date: string // ISO date (YYYY-MM-DD)
  amount: number // integer whole tenge, 0 when missing in source
  service: string | null
  address: string | null
  source: 'agbis_import' | 'manual'
  import_batch_id: string | null
  created_at: string
}

// One parsed row of the Agbis Excel export (pre-insert shape).
export interface ParsedImportOrder {
  phone: string
  order_date: string | null
  amount: number // integer whole tenge
  service: string | null
  address: string | null
}
