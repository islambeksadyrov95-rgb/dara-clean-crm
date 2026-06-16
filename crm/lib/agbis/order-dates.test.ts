import { describe, it, expect } from 'vitest'
import {
  intakeDateToAgbis,
  deliveryLocalToISO,
  deliveryISOToAgbis,
  almatyTodayYMD,
  almatyNowLocal,
  almatyNowPlusDaysLocal,
  formatAlmatyDateTime,
  ALMATY_OFFSET,
} from './order-dates'

describe('intakeDateToAgbis', () => {
  it('reformats a date to Agbis dd.mm.yyyy', () => {
    expect(intakeDateToAgbis('2026-06-16')).toBe('16.06.2026')
  })
  it('takes the date part of a datetime-local value (Agbis doc_date is date-only)', () => {
    expect(intakeDateToAgbis('2026-06-16T17:42')).toBe('16.06.2026')
  })
  it('returns null on malformed input', () => {
    expect(intakeDateToAgbis('16.06.2026')).toBeNull()
    expect(intakeDateToAgbis('')).toBeNull()
  })
})

describe('almatyNowLocal', () => {
  it('returns YYYY-MM-DDTHH:mm Almaty wall-clock', () => {
    // 2026-06-15T20:00:00Z = 2026-06-16 01:00 Almaty (+5)
    expect(almatyNowLocal(new Date('2026-06-15T20:00:00Z'))).toBe('2026-06-16T01:00')
  })
})

describe('almatyNowPlusDaysLocal', () => {
  it('adds N days to the current Almaty wall-clock (keeps the time)', () => {
    // 2026-06-16T10:00:00Z = 15:00 Almaty → +3 days = 2026-06-19T15:00
    expect(almatyNowPlusDaysLocal(3, new Date('2026-06-16T10:00:00Z'))).toBe('2026-06-19T15:00')
  })
})

describe('formatAlmatyDateTime', () => {
  it('formats stored ISO to dd.mm.yyyy HH:MM Almaty', () => {
    expect(formatAlmatyDateTime('2026-06-16T09:15:00+05:00')).toBe('16.06.2026 09:15')
  })
  it('converts a UTC instant to Almaty (+5)', () => {
    expect(formatAlmatyDateTime('2026-06-16T04:15:00Z')).toBe('16.06.2026 09:15')
  })
  it('returns null for null input', () => {
    expect(formatAlmatyDateTime(null)).toBeNull()
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
