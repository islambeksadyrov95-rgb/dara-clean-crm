import { describe, it, expect } from 'vitest'
import {
  ordersParamsFromSearch,
  ordersParamsFromUrl,
  ordersParamsToQuery,
  ordersListKey,
  PAGE_SIZE,
  type OrdersQueryParams,
} from './orders-query'

// Состояние списка теперь живёт в URL (?q/&service/&status/&manager/&payment/&from/&to/&page),
// чтобы возврат из карточки /orders/[id] восстанавливал страницу и фильтры. Сервер и клиент
// парсят URL одной логикой → queryKey совпадает, гидрация не рвётся.

const DEFAULTS: OrdersQueryParams = {
  search: '',
  service: 'Все',
  status: '',
  manager: '',
  payment: '',
  dateFrom: '',
  dateTo: '',
  page: 0,
}

describe('ordersParamsFromSearch', () => {
  it('пустые searchParams → дефолты', () => {
    expect(ordersParamsFromSearch({})).toEqual(DEFAULTS)
  })
  it('парсит все параметры состояния из URL', () => {
    expect(
      ordersParamsFromSearch({
        q: 'foo',
        service: 'Ковры',
        status: 'Новый',
        manager: 'Самал',
        payment: 'debt',
        from: '2026-01-01',
        to: '2026-02-01',
        page: '3',
      }),
    ).toEqual({
      search: 'foo',
      service: 'Ковры',
      status: 'Новый',
      manager: 'Самал',
      payment: 'debt',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      page: 3,
    })
  })
  it('невалидный payment → пустой; невалидная/отрицательная страница → 0', () => {
    expect(ordersParamsFromSearch({ payment: 'xxx', page: '-2' })).toMatchObject({ payment: '', page: 0 })
    expect(ordersParamsFromSearch({ page: 'abc' })).toMatchObject({ page: 0 })
  })
  it('массивные query-значения → берём первое', () => {
    expect(ordersParamsFromSearch({ status: ['Выданный', 'Новый'] })).toMatchObject({ status: 'Выданный' })
  })
})

describe('ordersParamsFromUrl', () => {
  it('парсит URLSearchParams так же, как серверный парсер', () => {
    const url = new URLSearchParams('q=foo&status=Новый&payment=paid&page=2')
    expect(ordersParamsFromUrl(url)).toMatchObject({ search: 'foo', status: 'Новый', payment: 'paid', page: 2 })
  })
})

describe('ordersParamsToQuery', () => {
  it('пишет только непустые значения (дефолты → пустая строка)', () => {
    expect(ordersParamsToQuery(DEFAULTS)).toBe('')
  })
  it('round-trip: params → query → params', () => {
    const p: OrdersQueryParams = {
      search: 'foo',
      service: 'Ковры',
      status: 'Новый',
      manager: 'Самал',
      payment: 'debt',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      page: 3,
    }
    expect(ordersParamsFromUrl(new URLSearchParams(ordersParamsToQuery(p)))).toEqual(p)
  })
})

describe('ordersListKey', () => {
  it('строит детерминированный ключ из параметров', () => {
    const key = ordersListKey(DEFAULTS)
    expect(key[0]).toBe('orders-list')
    expect(key[1]).toMatchObject({ search: '', service: 'Все', status: '', manager: '', payment: '', page: 0 })
  })
  it('ключ из дефолтов URL (сервер) совпадает с ключом первого рендера клиента', () => {
    const fromServer = ordersListKey(ordersParamsFromSearch({}))
    const fromClient = ordersListKey(ordersParamsFromUrl(new URLSearchParams('')))
    expect(JSON.stringify(fromServer)).toBe(JSON.stringify(fromClient))
  })
})

describe('PAGE_SIZE', () => {
  it('равен 100', () => {
    expect(PAGE_SIZE).toBe(100)
  })
})
