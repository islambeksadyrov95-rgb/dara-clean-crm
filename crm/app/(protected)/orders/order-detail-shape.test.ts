import { describe, it, expect } from 'vitest'
import { normalizeCrmOrder, normalizeHistoryOrder, toItem, toTripView, type OrderItemView } from './order-detail-shape'

const items: OrderItemView[] = [{ name: 'Табурет', qty: 1, unitPrice: 1000, lineAmount: 1000 }]

const crmRow = {
  id: 'o1', client_id: 'c1', client: { name: 'Иван' }, manager_id: 'm1',
  agbis_doc_num: '000267', agbis_order_id: '100279', agbis_status_name: 'Новый',
  amount: 1000, intake_date: '2026-06-16T09:15:00+05:00', delivery_date: '2026-06-18T10:00:00+05:00',
  comment: 'note', sync_status: 'synced',
  agbis_debet: null, cancel_requested: false, cancel_reason: null, cancelled_at: null,
}

describe('normalizeCrmOrder', () => {
  it('maps a CRM order row + items to the unified detail shape (самовывоз = no trips)', () => {
    const d = normalizeCrmOrder(crmRow, items, 'Самал', [])
    expect(d).toMatchObject({
      source: 'crm', id: 'o1', clientId: 'c1', clientName: 'Иван',
      docNum: '000267', dorId: '100279', statusName: 'Новый', amount: 1000,
      date: '16.06.2026 09:15', dateOut: '18.06.2026 10:00', address: null, trips: [],
      syncStatus: 'synced', receiver: 'Самал',
      isUnpaid: true, cancelRequested: false, cancelReason: null, cancelledAt: null,
    })
    expect(d.items).toHaveLength(1)
  })

  it('isUnpaid=false когда agbis_debet>0 (оплачен) — кнопка отмены прячется', () => {
    expect(normalizeCrmOrder({ ...crmRow, agbis_debet: 5000 }, items, null, []).isUnpaid).toBe(false)
  })

  it('переносит cancel-поля (запрошена отмена, ещё не исполнена)', () => {
    const d = normalizeCrmOrder({ ...crmRow, cancel_requested: true, cancel_reason: 8 }, items, null, [])
    expect(d).toMatchObject({ cancelRequested: true, cancelReason: 8, cancelledAt: null })
  })

  it('carries both trip arms from order_trips', () => {
    const trips = [
      toTripView({ kind: 'pickup', address: 'ул. Абая 1', agbis_car_id: '1023', agbis_trip_id: '9001', sync_status: 'synced', bound_at: '2026-06-21T10:00:00Z' }),
      toTripView({ kind: 'delivery', address: 'ул. Сатпаева 2', agbis_car_id: '1032', agbis_trip_id: null, sync_status: 'failed', bound_at: null }),
    ]
    const d = normalizeCrmOrder(crmRow, items, null, trips)
    expect(d.trips).toEqual([
      { kind: 'pickup', address: 'ул. Абая 1', carId: '1023', tripId: '9001', syncStatus: 'synced', boundAt: '2026-06-21T10:00:00Z' },
      { kind: 'delivery', address: 'ул. Сатпаева 2', carId: '1032', tripId: null, syncStatus: 'failed', boundAt: null },
    ])
  })
})

describe('normalizeHistoryOrder', () => {
  it('maps an order_history row + items to the unified detail shape', () => {
    const d = normalizeHistoryOrder({
      id: 'h1', client_id: 'c2', client: { name: 'Пётр' },
      agbis_doc_num: '000100', agbis_dor_id: '99000', agbis_status_name: 'Выдан',
      amount: 5000, order_date: '2026-01-10', agbis_date_out: '12.01.2026 10:00:00',
      agbis_user_name: 'Самал', address: 'ул. X', service: 'Ковёр',
    }, items)
    expect(d).toMatchObject({
      source: 'history', id: 'h1', clientId: 'c2', clientName: 'Пётр',
      docNum: '000100', dorId: '99000', statusName: 'Выдан', amount: 5000,
      date: '2026-01-10', dateOut: '12.01.2026 10:00:00', receiver: 'Самал', address: 'ул. X',
    })
  })

  it('falls back to the service text when there are no structured items', () => {
    const d = normalizeHistoryOrder({
      id: 'h2', client_id: 'c2', client: null, amount: 3000, order_date: '2026-02-01',
      service: 'Шторы', agbis_doc_num: null, agbis_dor_id: null, agbis_status_name: null,
      agbis_date_out: null, agbis_user_name: null, address: null,
    }, [])
    expect(d.items).toEqual([{ name: 'Шторы', qty: 1, unitPrice: 3000, lineAmount: 3000 }])
    expect(d.clientName).toBeNull()
  })
})

describe('toItem', () => {
  it('maps a raw item row, defaulting qty to 1', () => {
    expect(toItem({ name: 'X', qty: null, unit_price: 500, line_amount: 500 }))
      .toEqual({ name: 'X', qty: 1, unitPrice: 500, lineAmount: 500 })
  })
})
