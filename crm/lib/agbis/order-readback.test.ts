import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/agbis/client', () => ({ agbisCall: vi.fn() }))
vi.mock('@/lib/agbis/session', () => ({ getValidSession: vi.fn(async () => 'sid-1') }))

import {
  buildDayWindow,
  parseOrders,
  pickOrder,
  pickLatestOrderByContr,
  mapOrderMirror,
  readBackOrder,
  findExistingOrderByContr,
} from './order-readback'
import { agbisCall } from '@/lib/agbis/client'

beforeEach(() => vi.clearAllMocks())

describe('buildDayWindow', () => {
  it('wraps a dd.mm.yyyy date into a full-day Agbis window', () => {
    expect(buildDayWindow('16.06.2026')).toEqual({ StartDate: '16.06.2026 00:00', StopDate: '16.06.2026 23:59' })
  })
})

describe('parseOrders', () => {
  it('returns the orders array', () => {
    expect(parseOrders({ orders: [{ dor_id: '1' }] })).toEqual([{ dor_id: '1' }])
  })
  it('returns [] when orders missing or not an array', () => {
    expect(parseOrders({ error: 0 })).toEqual([])
    expect(parseOrders({ orders: 'x' })).toEqual([])
  })
})

describe('pickOrder', () => {
  it('finds an order by dor_id as string', () => {
    expect(pickOrder([{ dor_id: 100 }, { dor_id: 200 }], '200')).toEqual({ dor_id: 200 })
  })
  it('returns null when not found', () => {
    expect(pickOrder([{ dor_id: 1 }], '999')).toBeNull()
  })
})

describe('pickLatestOrderByContr', () => {
  it('returns the newest (highest dor_id) order for the contragent', () => {
    const orders = [
      { dor_id: '100', contr_id: '7' },
      { dor_id: '300', contr_id: '7' },
      { dor_id: '200', contr_id: '9' },
    ]
    expect(pickLatestOrderByContr(orders, '7')).toEqual({ dor_id: '300', contr_id: '7' })
  })
  it('returns null when no order belongs to the contragent', () => {
    expect(pickLatestOrderByContr([{ dor_id: '1', contr_id: '9' }], '7')).toBeNull()
  })
  it('matches contr_id across string/number forms', () => {
    expect(pickLatestOrderByContr([{ dor_id: 5, contr_id: 7 }], '7')).toEqual({ dor_id: 5, contr_id: 7 })
  })
})

describe('findExistingOrderByContr', () => {
  it('returns the existing dor_id when Agbis already holds an order for the contragent', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ orders: [
      { dor_id: '100277', contr_id: '7', doc_num: '000265', status_id: '1', status_name: 'Новый', date_out_fact: '' },
    ] })
    expect(await findExistingOrderByContr('7', '16.06.2026')).toEqual({
      ok: true,
      found: { dorId: '100277', docNum: '000265', statusId: 1, statusName: 'Новый', dateOutFact: null },
    })
  })
  it('reports found:null when the contragent has no order in the window', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ orders: [{ dor_id: '1', contr_id: '9' }] })
    expect(await findExistingOrderByContr('7', '16.06.2026')).toEqual({ ok: true, found: null })
  })
  it('reports ok:false on API failure (must NOT be read as "no order exists")', async () => {
    vi.mocked(agbisCall).mockRejectedValue(new Error('504'))
    expect(await findExistingOrderByContr('7', '16.06.2026')).toEqual({ ok: false })
  })
})

describe('mapOrderMirror', () => {
  it('extracts doc_num, status and date_out_fact', () => {
    expect(mapOrderMirror({
      dor_id: '100277', doc_num: '000265', status_id: '1', status_name: 'Новый', date_out_fact: '',
    })).toEqual({ docNum: '000265', statusId: 1, statusName: 'Новый', dateOutFact: null })
  })
  it('keeps a non-empty date_out_fact', () => {
    expect(mapOrderMirror({ doc_num: 'x', status_id: '5', status_name: 'Выдан', date_out_fact: '18.06.2026 10:00:00' }).dateOutFact)
      .toBe('18.06.2026 10:00:00')
  })
})

describe('readBackOrder', () => {
  it('returns the mirror for the matching dor_id', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ orders: [
      { dor_id: '100277', doc_num: '000265', status_id: '1', status_name: 'Новый', date_out_fact: '' },
    ] })
    expect(await readBackOrder('100277', '16.06.2026')).toEqual({
      docNum: '000265', statusId: 1, statusName: 'Новый', dateOutFact: null,
    })
  })
  it('returns null when the order is not in the window', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ orders: [] })
    expect(await readBackOrder('100277', '16.06.2026')).toBeNull()
  })
  it('returns null (never throws) on API failure', async () => {
    vi.mocked(agbisCall).mockRejectedValue(new Error('504'))
    expect(await readBackOrder('100277', '16.06.2026')).toBeNull()
  })
})
