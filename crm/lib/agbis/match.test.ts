import { describe, it, expect } from 'vitest'
import { matchOrders, type ExistingHistoryRow } from '@/lib/agbis/match'
import type { AgbisSyncOrder } from '@/lib/agbis/sync-types'

function order(dorId: string, orderDate: string | null, amount = 1000): AgbisSyncOrder {
  return {
    dorId,
    docNum: null,
    contrId: 'c1',
    amount,
    debet: null,
    dolg: null,
    orderDate,
    dateOut: null,
    statusId: 4,
    statusName: 'Исполненный',
    userId: '1',
    userName: 'Дарын',
    discount: null,
    services: [],
    products: [],
  }
}

function row(id: string, orderDate: string, agbisDorId: string | null = null): ExistingHistoryRow {
  return { id, orderDate, agbisDorId }
}

describe('matchOrders', () => {
  it('re-syncs an order whose dor_id already exists (idempotent, no duplicate insert)', () => {
    const r = matchOrders([order('100', '2025-03-01')], [row('row-x', '2025-03-01', '100')])
    expect(r.resyncs).toEqual([{ rowId: 'row-x', order: order('100', '2025-03-01') }])
    expect(r.enrich).toEqual([])
    expect(r.inserts).toEqual([])
  })

  it('enriches an un-enriched existing row matched by (client+date)', () => {
    const r = matchOrders([order('200', '2025-03-01')], [row('row-y', '2025-03-01', null)])
    expect(r.enrich).toEqual([{ rowId: 'row-y', order: order('200', '2025-03-01') }])
    expect(r.inserts).toEqual([])
  })

  it('inserts a new Agbis order when no existing row shares its date', () => {
    const r = matchOrders([order('300', '2025-04-01')], [row('row-z', '2025-03-01', null)])
    expect(r.inserts).toEqual([order('300', '2025-04-01')])
    expect(r.enrich).toEqual([])
  })

  it('greedily matches one-to-one: 2 rows + 3 orders same date → 2 enrich + 1 insert', () => {
    const orders = [order('1', '2025-03-01'), order('2', '2025-03-01'), order('3', '2025-03-01')]
    const rows = [row('a', '2025-03-01'), row('b', '2025-03-01')]
    const r = matchOrders(orders, rows)
    expect(r.enrich).toHaveLength(2)
    expect(r.inserts).toHaveLength(1)
    // every existing row claimed at most once
    const claimedRowIds = r.enrich.map((e) => e.rowId)
    expect(new Set(claimedRowIds).size).toBe(2)
  })

  it('leaves surplus existing rows untouched (ENRICH, not wipe)', () => {
    const r = matchOrders([order('1', '2025-03-01')], [row('a', '2025-03-01'), row('b', '2025-03-01')])
    expect(r.enrich).toHaveLength(1)
    expect(r.inserts).toHaveLength(0)
    // row 'b' is simply not in any bucket — caller must not delete it
  })

  it('skips an order with no parseable date (order_date is NOT NULL)', () => {
    const r = matchOrders([order('9', null)], [])
    expect(r.skipped).toEqual([{ order: order('9', null), reason: 'no_order_date' }])
    expect(r.inserts).toEqual([])
  })

  it('dedupes orders by dor_id within one batch (defensive)', () => {
    const r = matchOrders([order('5', '2025-03-01'), order('5', '2025-03-01')], [])
    expect(r.inserts).toHaveLength(1)
  })

  it('does not re-claim a row across resync and enrich', () => {
    // dor 100 already on row-a; a different un-enriched row-b same date for dor 101.
    const r = matchOrders(
      [order('100', '2025-03-01'), order('101', '2025-03-01')],
      [row('row-a', '2025-03-01', '100'), row('row-b', '2025-03-01', null)],
    )
    expect(r.resyncs.map((x) => x.rowId)).toEqual(['row-a'])
    expect(r.enrich.map((x) => x.rowId)).toEqual(['row-b'])
    expect(r.inserts).toEqual([])
  })
})
