import { describe, it, expect } from 'vitest'
import { resolveDateRange, daysAgoAlmaty, todayAlmaty } from '@/lib/filters/dates'

describe('dates', () => {
  it('resolves explicit from/to as-is', () => {
    expect(resolveDateRange({ from: '2026-01-01', to: '2026-02-01' }))
      .toEqual({ from: '2026-01-01', to: '2026-02-01' })
  })

  it('resolves last30 preset to a 30-day window ending today (Almaty)', () => {
    const { from, to } = resolveDateRange({ preset: 'last30' })
    expect(to).toBe(todayAlmaty())
    expect(from).toBe(daysAgoAlmaty(30))
  })

  it('resolves today preset to a single-day window', () => {
    expect(resolveDateRange({ preset: 'today' })).toEqual({ from: todayAlmaty(), to: todayAlmaty() })
  })

  it('daysAgoAlmaty(0) equals today and dates are ISO-formatted', () => {
    expect(daysAgoAlmaty(0)).toBe(todayAlmaty())
    expect(todayAlmaty()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

