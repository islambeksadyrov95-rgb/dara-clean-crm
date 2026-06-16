import { describe, it, expect } from 'vitest'
import {
  buildContragBody,
  buildSaveOrderBody,
  parseContragResponse,
  parseSaveOrderResponse,
} from './write-commands'

describe('buildContragBody', () => {
  it('includes required name/fullname and omits empty optionals', () => {
    const body = buildContragBody({ name: 'Иванов И.', fullname: 'Иванов Иван' })
    expect(body.name).toBe('Иванов И.')
    expect(body.fullname).toBe('Иванов Иван')
    expect('teleph_cell' in body).toBe(false)
    expect('contr_id' in body).toBe(false)
  })

  it('passes phone and contr_id when present (update path)', () => {
    const body = buildContragBody({
      name: 'Иванов И.', fullname: 'Иванов Иван', telephCell: '+77001234567', contrId: '555',
    })
    expect(body.teleph_cell).toBe('+77001234567')
    expect(body.contr_id).toBe('555')
  })
})

describe('buildSaveOrderBody', () => {
  it('builds Order + Services with string values, sequential dos_id, empty addons', () => {
    const body = buildSaveOrderBody({
      contrId: '100', scladId: '1023', scladOutId: '1023', priceId: '0', statusId: 1,
      docDate: '16.06.2026',
      services: [
        { tovarId: '102419', count: 1 },
        { tovarId: '102420', count: 2, discount: 10 },
      ],
    })
    expect(body.Order.contr_id).toBe('100')
    expect(body.Order.sclad_id).toBe('1023')
    expect(body.Order.sclad_out_id).toBe('1023')
    expect(body.Order.price_id).toBe('0')
    expect(body.Order.status_id).toBe('1')
    expect(body.Products).toEqual([])
    expect(body.Comments).toEqual([])
    expect(body.Services).toHaveLength(2)
    expect(body.Services[0]).toMatchObject({ dos_id: '1', tovar_id: '102419', count: '1', addons: [] })
    expect(body.Services[1]).toMatchObject({ dos_id: '2', tovar_id: '102420', count: '2', discount: '10' })
  })
})

describe('parseContragResponse', () => {
  it('extracts contr_id and wasNew', () => {
    expect(parseContragResponse({ error: 0, contr_id: '777', WasNew: '1' })).toEqual({
      contrId: '777', wasNew: true,
    })
  })
  it('throws on missing contr_id', () => {
    expect(() => parseContragResponse({ error: 0 })).toThrow()
  })
})

describe('parseSaveOrderResponse', () => {
  it('extracts dor_id', () => {
    expect(parseSaveOrderResponse({ error: 0, dor_id: '1032365' })).toEqual({ dorId: '1032365' })
  })
  it('throws on missing dor_id', () => {
    expect(() => parseSaveOrderResponse({ error: 0 })).toThrow()
  })
})
