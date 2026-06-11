import { describe, it, expect } from 'vitest'
import type { OrderHistoryRow, ParsedImportOrder } from '@/types/order-history'

// Contract tests: Phase 1 shared types (compile-time shape + runtime invariants
// the contract documents). If these stop compiling, an agent broke the contract.

describe('order-history contract', () => {
  it('OrderHistoryRow accepts a full agbis_import row with nullable fields', () => {
    const row: OrderHistoryRow = {
      id: 'b6f7d8e9-0000-0000-0000-000000000001',
      client_id: 'b6f7d8e9-0000-0000-0000-000000000002',
      order_date: '2025-12-10',
      amount: 17000,
      service: null,
      address: null,
      source: 'agbis_import',
      import_batch_id: null,
      created_at: '2026-06-12T00:00:00Z',
    }
    expect(Number.isInteger(row.amount)).toBe(true)
    expect(['agbis_import', 'manual']).toContain(row.source)
  })

  it('ParsedImportOrder allows missing date/service/address but requires phone and integer amount', () => {
    const parsed: ParsedImportOrder = {
      phone: '+77771119944',
      order_date: null,
      amount: 0,
      service: null,
      address: null,
    }
    expect(parsed.phone.startsWith('+7')).toBe(true)
    expect(Number.isInteger(parsed.amount)).toBe(true)
  })
})
