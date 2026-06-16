import { describe, it, expect } from 'vitest'
import {
  intakeDateToAgbis,
  deliveryLocalToISO,
  deliveryISOToAgbis,
  almatyTodayYMD,
  ALMATY_OFFSET,
} from './order-dates'

describe('intakeDateToAgbis', () => {
  it('reformats ISO date to Agbis dd.mm.yyyy', () => {
    expect(intakeDateToAgbis('2026-06-16')).toBe('16.06.2026')
  })
  it('returns null on malformed input', () => {
    expect(intakeDateToAgbis('16.06.2026')).toBeNull()
    expect(intakeDateToAgbis('')).toBeNull()
  })
})

describe('deliveryLocalToISO', () => {
  it('attaches Almaty offset to a datetime-local value', () => {
    expect(deliveryLocalToISO('2026-06-18T14:30')).toBe(`2026-06-18T14:30:00${ALMATY_OFFSET}`)
  })
  it('returns null on malformed input', () => {
    expect(deliveryLocalToISO('2026-06-18')).toBeNull()
  })
})

describe('deliveryISOToAgbis', () => {
  it('formats stored ISO to Almaty wall-clock dd.mm.yyyy HH:MM:SS', () => {
    expect(deliveryISOToAgbis('2026-06-18T14:30:00+05:00')).toBe('18.06.2026 14:30:00')
  })
  it('round-trips a local value through storage format', () => {
    const iso = deliveryLocalToISO('2026-12-31T09:05')
    expect(iso).not.toBeNull()
    expect(deliveryISOToAgbis(iso as string)).toBe('31.12.2026 09:05:00')
  })
  it('converts a UTC instant into Almaty (+5) wall-clock', () => {
    // 2026-06-18T09:30:00Z = 14:30 Almaty
    expect(deliveryISOToAgbis('2026-06-18T09:30:00Z')).toBe('18.06.2026 14:30:00')
  })
  it('returns null on malformed input', () => {
    expect(deliveryISOToAgbis('not-a-date')).toBeNull()
  })
})

describe('almatyTodayYMD', () => {
  it('returns YYYY-MM-DD in Almaty timezone', () => {
    // 2026-06-15T20:00:00Z = 2026-06-16 01:00 Almaty → date rolls to the 16th
    expect(almatyTodayYMD(new Date('2026-06-15T20:00:00Z'))).toBe('2026-06-16')
  })
})
