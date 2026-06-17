import { describe, it, expect } from 'vitest'
import { parsePresetIndex, queueListKey, FILTER_PRESETS, type QueueQueryParams } from './queue-query'

describe('parsePresetIndex', () => {
  it('возвращает 0 для null/мусора/вне диапазона', () => {
    expect(parsePresetIndex(null)).toBe(0)
    expect(parsePresetIndex('abc')).toBe(0)
    expect(parsePresetIndex('-1')).toBe(0)
    expect(parsePresetIndex(String(FILTER_PRESETS.length))).toBe(0)
  })
  it('возвращает валидный индекс пресета', () => {
    expect(parsePresetIndex('1')).toBe(1)
    expect(parsePresetIndex('3')).toBe(3)
  })
})

describe('queueListKey', () => {
  const base: QueueQueryParams = {
    presetMin: 1, presetMax: 9999, userId: 'u1', isAdmin: false,
    pageSize: 50, conditions: [], viewManagerId: null,
  }
  it('строит детерминированный ключ из параметров', () => {
    const key = queueListKey(base)
    expect(key[0]).toBe('queue-list')
    expect(key[1]).toMatchObject({ presetMin: 1, presetMax: 9999, userId: 'u1', pageSize: 50, viewManagerId: null })
  })
  it('одинаковые параметры → структурно равный ключ (для совпадения SSR-префетча и клиента)', () => {
    expect(JSON.stringify(queueListKey(base))).toBe(JSON.stringify(queueListKey({ ...base })))
  })
})
