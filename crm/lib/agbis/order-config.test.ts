import { describe, it, expect } from 'vitest'
import {
  AGBIS_PRICE_ID,
  AGBIS_NEW_STATUS_ID,
  AGBIS_DEFAULT_SCLAD_ID,
  AGBIS_WAREHOUSES,
  isKnownWarehouse,
} from './order-config'

describe('agbis order-config', () => {
  it('uses the single retail price list and "new" status', () => {
    expect(AGBIS_PRICE_ID).toBe('0')
    expect(AGBIS_NEW_STATUS_ID).toBe(1)
  })

  it('default warehouse is a known warehouse', () => {
    expect(isKnownWarehouse(AGBIS_DEFAULT_SCLAD_ID)).toBe(true)
  })

  it('lists warehouses with id and name, default included', () => {
    expect(AGBIS_WAREHOUSES.length).toBeGreaterThan(0)
    expect(AGBIS_WAREHOUSES.every((w) => w.id && w.name)).toBe(true)
    expect(AGBIS_WAREHOUSES.some((w) => w.id === AGBIS_DEFAULT_SCLAD_ID)).toBe(true)
  })

  it('rejects unknown warehouse ids', () => {
    expect(isKnownWarehouse('999999')).toBe(false)
    expect(isKnownWarehouse('')).toBe(false)
  })
})
