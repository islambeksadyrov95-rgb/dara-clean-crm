import { describe, it, expect } from 'vitest'
import {
  agbisDateToYmd,
  generateHalfMonthWindows,
  incrementalWindow,
} from '@/lib/agbis/windows'

describe('agbisDateToYmd', () => {
  it('reformats dd.mm.yyyy to yyyy-mm-dd WITHOUT timezone shift', () => {
    // The timezone trap: 15.06.2026 midnight-local must stay the 15th, not roll to the 14th.
    expect(agbisDateToYmd('15.06.2026')).toBe('2026-06-15')
    expect(agbisDateToYmd('01.01.2025')).toBe('2025-01-01')
  })

  it('ignores a trailing time component', () => {
    expect(agbisDateToYmd('15.06.2026 00:00')).toBe('2026-06-15')
    expect(agbisDateToYmd('31.12.2025 23:59:59')).toBe('2025-12-31')
  })

  it('returns null for malformed or non-string input', () => {
    expect(agbisDateToYmd('2026-06-15')).toBeNull()
    expect(agbisDateToYmd('')).toBeNull()
    expect(agbisDateToYmd(null)).toBeNull()
    expect(agbisDateToYmd(123)).toBeNull()
  })
})

describe('generateHalfMonthWindows', () => {
  it('splits each month into 1-15 and 16-end windows', () => {
    const w = generateHalfMonthWindows('2026-02-01', '2026-02-28')
    expect(w).toEqual([
      { start: '01.02.2026 00:00', stop: '15.02.2026 23:59' },
      { start: '16.02.2026 00:00', stop: '28.02.2026 23:59' }, // 2026 not a leap year
    ])
  })

  it('handles 31-day months and spans across a year boundary', () => {
    const w = generateHalfMonthWindows('2025-12-01', '2026-01-31')
    expect(w).toEqual([
      { start: '01.12.2025 00:00', stop: '15.12.2025 23:59' },
      { start: '16.12.2025 00:00', stop: '31.12.2025 23:59' },
      { start: '01.01.2026 00:00', stop: '15.01.2026 23:59' },
      { start: '16.01.2026 00:00', stop: '31.01.2026 23:59' },
    ])
  })

  it('returns empty for malformed bounds', () => {
    expect(generateHalfMonthWindows('bad', '2026-01-31')).toEqual([])
  })
})

describe('incrementalWindow', () => {
  it('builds an Almaty-local bound from the last cursor to now', () => {
    // 2026-06-16T05:00:00Z = 10:00 Almaty (UTC+5)
    const w = incrementalWindow('2026-06-16T05:00:00Z', '2026-06-16T07:30:00Z')
    expect(w).toEqual({ start: '16.06.2026 10:00', stop: '16.06.2026 12:30' })
  })

  it('returns null for malformed input', () => {
    expect(incrementalWindow('nope', '2026-06-16T07:30:00Z')).toBeNull()
  })
})
