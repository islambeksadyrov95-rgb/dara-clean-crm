import { describe, it, expect } from 'vitest'
import {
  CARPET_TOVAR_ID, CARPET_TYPE_ADDON_ID, CARPET_AREA_ADDON_ID,
  computeArea, buildCarpetFigure, buildCarpetAddons, estimateCarpetPrice,
  parseCarpetTypes, parseCarpetShapes,
} from './carpet'

describe('computeArea', () => {
  it('rectangle = a×b', () => expect(computeArea('2', 2, 3)).toBe(6))
  it('square = a²', () => expect(computeArea('1', 2, 0)).toBe(4))
  it('circle = π(d/2)²', () => expect(computeArea('3', 2, 0)).toBeCloseTo(3.14, 2))
  it('oval = π·a·b/4', () => expect(computeArea('4', 2, 4)).toBeCloseTo(6.28, 2))
  it('0 for non-positive dims', () => expect(computeArea('2', 0, 3)).toBe(0))
})

describe('buildCarpetFigure', () => {
  it('matches the real Agbis figure format dim1|dim2|shape|', () => {
    expect(buildCarpetFigure('2', 2, 3)).toBe('2|3|2|')
  })
  it('repeats the single dimension for one-dim shapes', () => {
    expect(buildCarpetFigure('1', 2, 0)).toBe('2|2|1|')
  })
})

describe('buildCarpetAddons', () => {
  it('builds the {addon_id, values} pair confirmed live', () => {
    expect(buildCarpetAddons('1002336', '2|3|2|')).toEqual([
      { addon_id: CARPET_TYPE_ADDON_ID, values: '1002336' },
      { addon_id: CARPET_AREA_ADDON_ID, values: '2|3|2|' },
    ])
  })
})

describe('estimateCarpetPrice', () => {
  it('rounds area × price-per-m²', () => {
    expect(estimateCarpetPrice(6, 1500)).toBe(9000)
    expect(estimateCarpetPrice(6.28, 1000)).toBe(6280)
  })
})

describe('parseCarpetTypes / parseCarpetShapes', () => {
  const addonTypes = {
    addon_types: [
      { id: '100241', addon_str_values: [
        { id: '1002336', value_str: 'Иранский', value_flt: '1500' },
        { id: '1002338', value_str: 'Палас', value_flt: '1000' },
      ] },
      { id: '100242', addon_str_values: [
        { id: '1002344', value_str: 'Квадрат', value_flt: '1' },
        { id: '1002345', value_str: 'Прямоугольник', value_flt: '2' },
      ] },
    ],
  }
  it('extracts carpet types with price-per-m²', () => {
    expect(parseCarpetTypes(addonTypes)).toEqual([
      { strId: '1002336', name: 'Иранский', pricePerM2: 1500 },
      { strId: '1002338', name: 'Палас', pricePerM2: 1000 },
    ])
  })
  it('extracts shapes with their figure flt', () => {
    expect(parseCarpetShapes(addonTypes)).toEqual([
      { shapeFlt: '1', name: 'Квадрат' },
      { shapeFlt: '2', name: 'Прямоугольник' },
    ])
  })
  it('returns [] when addon types absent', () => {
    expect(parseCarpetTypes({})).toEqual([])
    expect(parseCarpetShapes({})).toEqual([])
  })

  it('exposes the carpet tovar id', () => {
    expect(CARPET_TOVAR_ID).toBe('100387')
  })
})
