import { describe, it, expect } from 'vitest'
import { normalizeCrmOrder, normalizeHistoryOrder, toItem, type OrderItemView } from './order-detail-shape'

const items: OrderItemView[] = [{ name: 'Табурет', qty: 1, unitPrice: 1000, lineAmount: 1000 }]

describe('normalizeCrmOrder', () => {
  it('maps a CRM order row + items to the unified detail shape', () => {
    const d = normalizeCrmOrder({
      id: 'o1', client_id: 'c1', client: { name: 'Иван' }, manager_id: 'm1',
      agbis_doc_num: '000267', agbis_order_id: '100279', agbis_status_name: 'Новый',
      amount: 1000, intake_date: '2026-06-16T09:15:00+05:00', delivery_date: '2026-06-18T10:00:00+05:00',
      comment: 'note', delivery_type: 'self', delivery_address: null, sync_status: 'synced',
    }, items, 'Самал')
    expect(d).toMatchObject({
      source: 'crm', id: 'o1', clientId: 'c1', clientName: 'Иван',
      docNum: '000267', dorId: '100279', statusName: 'Новый', amount: 1000,
      date: '16.06.2026 09:15', dateOut: '18.06.2026 10:00', deliveryType: 'self',
      syncStatus: 'synced', receiver: 'Самал',
    })
    expect(d.items).toHaveLength(1)
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
