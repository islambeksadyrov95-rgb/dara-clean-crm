import { describe, it, expect, vi } from 'vitest'

// getClientsList — Server Action ('use server'); в юнит-тесте достаточно заглушки,
// тестируем чистые функции построения параметров/ключа (load-bearing для SSR-дегидрации).
vi.mock('./actions', () => ({ getClientsList: vi.fn() }))

import { clientsParamsFromSearch, clientsListKey, PAGE_SIZE, type ClientsQueryParams } from './clients-query'

describe('clientsParamsFromSearch', () => {
  it('дефолты первого рендера: пустой поиск, сегмент «Все», страница 0, без условий', () => {
    expect(clientsParamsFromSearch({})).toEqual({ search: '', segment: 'Все', page: 0, conditions: [] })
  })
  it('читает условия из ?f= (как клиент на маунте)', () => {
    const params = clientsParamsFromSearch({ f: '[]' })
    expect(params).toMatchObject({ search: '', segment: 'Все', page: 0 })
    expect(Array.isArray(params.conditions)).toBe(true)
  })
  it('игнорирует массивные/отсутствующие значения f', () => {
    expect(clientsParamsFromSearch({ f: ['a', 'b'] }).conditions).toEqual([])
  })
})

describe('clientsListKey', () => {
  const base: ClientsQueryParams = { search: '', segment: 'Все', page: 0, conditions: [] }
  it('строит детерминированный ключ из параметров', () => {
    const key = clientsListKey(base)
    expect(key[0]).toBe('clients-list')
    expect(key[1]).toMatchObject({ search: '', segment: 'Все', page: 0, conditions: [] })
  })
  it('одинаковые параметры → структурно равный ключ (SSR-префетч ↔ клиент)', () => {
    expect(JSON.stringify(clientsListKey(base))).toBe(JSON.stringify(clientsListKey({ ...base })))
  })
  it('ключ из дефолтов URL совпадает с ключом первого рендера клиента', () => {
    const fromUrl = clientsListKey(clientsParamsFromSearch({}))
    const fromClientDefaults = clientsListKey({ search: '', segment: 'Все', page: 0, conditions: [] })
    expect(JSON.stringify(fromUrl)).toBe(JSON.stringify(fromClientDefaults))
  })
})

describe('PAGE_SIZE', () => {
  it('равен 20 (как прежний клиент)', () => {
    expect(PAGE_SIZE).toBe(20)
  })
})
