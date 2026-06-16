import { describe, it, expect } from 'vitest'
import { mapSyncClient, mapSyncOrder } from '@/lib/agbis/sync-types'

describe('mapSyncClient', () => {
  it('maps a raw ClientsByDateTimeForAll client to a typed client', () => {
    const raw = {
      contr_id: '12345',
      fullname: 'Иванов Иван Иванович',
      name: 'Иванов И.И.',
      teleph_cell: '+77001234567',
      telephone: '',
      email: 'a@b.kz',
      address: 'Алматы, Абая 1',
      gender: '0',
      is_active: '1',
      is_deleted: '0',
      order_count: '7',
      bonus: '0',
      deposit: '0',
      dolg: '0',
      pay_summ: '693 942,49',
      first_order_date: '01.01.2025',
      last_order_date: '15.06.2026',
    }
    expect(mapSyncClient(raw)).toEqual({
      contrId: '12345',
      fullname: 'Иванов Иван Иванович',
      name: 'Иванов И.И.',
      telephone: null,
      telephCell: '+77001234567',
      email: 'a@b.kz',
      address: 'Алматы, Абая 1',
      gender: 0,
      isActive: true,
      isDeleted: false,
      orderCount: 7,
      bonus: 0,
      deposit: 0,
      dolg: 0,
      paySumm: 693942, // money rounds "693 942,49" → 693942 whole tenge
      firstOrderDate: '2025-01-01',
      lastOrderDate: '2026-06-15',
    })
  })

  it('returns null when contr_id is missing', () => {
    expect(mapSyncClient({ name: 'x' })).toBeNull()
  })

  it('treats is_deleted=1 as deleted', () => {
    const c = mapSyncClient({ contr_id: '1', is_deleted: '1' })
    expect(c?.isDeleted).toBe(true)
  })
})

describe('mapSyncOrder', () => {
  it('maps a raw OrderByDateTimeForAll order with services to a typed order', () => {
    const raw = {
      dor_id: '100182',
      doc_num: '1234-25',
      contr_id: '12345',
      kredit: '12 800,50',
      debet: '0',
      doc_date: '15.06.2026 14:30',
      status: '4',
      status_name: 'Исполненный',
      user_id: '1022',
      user_name: 'Дарын',
      discount: '10',
      Srvices: [
        {
          dos_id: '555',
          tov_id: '500',
          service: 'Чистка ковра',
          code: 'K1',
          price: '1 500,00',
          qty: '8',
          kfx: '1',
          discount: '10',
          kredit: '10 800,00',
          status_id: '4',
          status_name: 'Исполненный',
        },
        { service: '' }, // invalid — dropped
      ],
    }
    const order = mapSyncOrder(raw)
    expect(order).toMatchObject({
      dorId: '100182',
      docNum: '1234-25',
      contrId: '12345',
      amount: 12801, // money rounds "12 800,50" → 12801
      orderDate: '2026-06-15', // calendar date, NO timezone shift
      statusId: 4,
      statusName: 'Исполненный',
      userName: 'Дарын',
    })
    expect(order?.services).toHaveLength(1)
    expect(order?.services[0]).toEqual({
      dosId: '555',
      tovId: '500',
      service: 'Чистка ковра',
      code: 'K1',
      price: 1500,
      qty: 8,
      kfx: 1,
      discount: 10,
      lineAmount: 10800,
      statusId: 4,
      statusName: 'Исполненный',
    })
  })

  it('maps payment/date header fields and Tovars products', () => {
    const order = mapSyncOrder({
      dor_id: '1',
      contr_id: '2',
      kredit: '10 000,00',
      debet: '7 000,00',
      dolg: '3 000,00',
      doc_date: '01.03.2025',
      date_out: '05.03.2025 14:00',
      discount: '10',
      Srvices: [],
      Tovars: [{ dol_id: '9', tov_id: '777', tovar_name: 'Освежитель', price: '500', qty: '2', kredit: '1 000,00', discount: '0' }],
    })
    expect(order).toMatchObject({ debet: 7000, dolg: 3000, dateOut: '2025-03-05', discount: 10 })
    expect(order?.products).toHaveLength(1)
    expect(order?.products[0]).toMatchObject({ tovId: '777', service: 'Освежитель', price: 500, lineAmount: 1000 })
    expect(order?.services).toEqual([])
  })

  it('returns null when dor_id or contr_id is missing', () => {
    expect(mapSyncOrder({ contr_id: '1' })).toBeNull()
    expect(mapSyncOrder({ dor_id: '1' })).toBeNull()
  })

  it('handles an order with no services array', () => {
    const order = mapSyncOrder({ dor_id: '1', contr_id: '2', kredit: '0', doc_date: '01.03.2025' })
    expect(order?.services).toEqual([])
    expect(order?.amount).toBe(0)
    expect(order?.orderDate).toBe('2025-03-01')
  })
})
