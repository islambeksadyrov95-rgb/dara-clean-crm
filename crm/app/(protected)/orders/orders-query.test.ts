import { describe, it, expect } from 'vitest'
import { ordersParamsFromSearch, ordersListKey, PAGE_SIZE, type OrdersQueryParams } from './orders-query'

describe('ordersParamsFromSearch', () => {
  it('дефолты первого рендера: пустой поиск, услуга «Все», без дат, страница 0', () => {
    expect(ordersParamsFromSearch({})).toEqual({
      search: '', service: 'Все', dateFrom: '', dateTo: '', page: 0,
    })
  })
  it('страница /orders не читает фильтры из URL — игнорирует любые query-параметры', () => {
    expect(ordersParamsFromSearch({ f: '[]', search: 'foo', page: '3' })).toEqual({
      search: '', service: 'Все', dateFrom: '', dateTo: '', page: 0,
    })
  })
})

describe('ordersListKey', () => {
  const base: OrdersQueryParams = { search: '', service: 'Все', dateFrom: '', dateTo: '', page: 0 }
  it('строит детерминированный ключ из параметров', () => {
    const key = ordersListKey(base)
    expect(key[0]).toBe('orders-list')
    expect(key[1]).toMatchObject({ search: '', service: 'Все', dateFrom: '', dateTo: '', page: 0 })
  })
  it('одинаковые параметры → структурно равный ключ (SSR-префетч ↔ клиент)', () => {
    expect(JSON.stringify(ordersListKey(base))).toBe(JSON.stringify(ordersListKey({ ...base })))
  })
  it('ключ из дефолтов URL совпадает с ключом первого рендера клиента', () => {
    const fromUrl = ordersListKey(ordersParamsFromSearch({}))
    const fromClientDefaults = ordersListKey({ search: '', service: 'Все', dateFrom: '', dateTo: '', page: 0 })
    expect(JSON.stringify(fromUrl)).toBe(JSON.stringify(fromClientDefaults))
  })
})

describe('PAGE_SIZE', () => {
  it('равен 20 (как прежний клиент)', () => {
    expect(PAGE_SIZE).toBe(20)
  })
})
