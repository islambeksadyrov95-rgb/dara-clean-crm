import { describe, it, expect } from 'vitest'
import { enc, decodeAll, money, parseDate } from '@/lib/agbis/helpers'

describe('enc — single URL-encode of the whole JSON param (Agbis gotcha)', () => {
  it('encodes the JSON literal once; decodeURIComponent round-trips', () => {
    const obj = { User: 'Дарын', Pwd: 'abc123', AsUser: '1' }
    const out = enc(obj)
    expect(out).toContain('%7B') // '{' is encoded, i.e. not left raw
    expect(decodeURIComponent(out)).toBe(JSON.stringify(obj))
  })

  it('encodes cyrillic and is NOT double-encoded', () => {
    const out = enc({ price_id: '0' })
    expect(decodeURIComponent(out)).toBe('{"price_id":"0"}')
    // double-encoding would turn '%' into '%25'
    expect(out).not.toContain('%25')
  })
})

describe('decodeAll — recursive URL-decode of response strings', () => {
  it('decodes %2B to + (phone) and + to space', () => {
    expect(decodeAll('%2B79990009900')).toBe('+79990009900')
    expect(decodeAll('Не%20срочный')).toBe('Не срочный')
    expect(decodeAll('a+b')).toBe('a b')
  })

  it('decodes cyrillic percent-escapes', () => {
    expect(decodeAll('%D0%9A')).toBe('К')
  })

  it('recurses into objects and arrays', () => {
    expect(decodeAll({ name: '%D0%9A', arr: ['%2B7', 'x'] })).toEqual({
      name: 'К',
      arr: ['+7', 'x'],
    })
  })

  it('passes through non-strings and leaves malformed escapes intact', () => {
    expect(decodeAll(123)).toBe(123)
    expect(decodeAll(null)).toBe(null)
    expect(decodeAll('%ZZ')).toBe('%ZZ')
  })
})

describe('money — Agbis "801,93" string → integer whole tenge', () => {
  it('rounds decimal comma to whole tenge', () => {
    expect(money('801,93')).toBe(802)
    expect(money('693942,49')).toBe(693942)
    expect(money('0,00')).toBe(0)
  })

  it('strips thousand-separator spaces', () => {
    expect(money('12 800,50')).toBe(12801)
  })

  it('accepts plain numbers and numeric strings', () => {
    expect(money('1500')).toBe(1500)
    expect(money(1500)).toBe(1500)
    expect(money(1500.7)).toBe(1501)
  })

  it('returns null for empty / blank / non-numeric / nullish', () => {
    expect(money('')).toBeNull()
    expect(money('   ')).toBeNull()
    expect(money('abc')).toBeNull()
    expect(money(null)).toBeNull()
    expect(money(undefined)).toBeNull()
  })
})

describe('parseDate — Agbis dd.mm.yyyy[ HH:MM[:SS]] (Almaty UTC+5) → UTC ISO', () => {
  it('parses date-only as Almaty midnight', () => {
    expect(parseDate('15.06.2026')).toBe('2026-06-14T19:00:00.000Z')
  })

  it('parses date-time with and without seconds', () => {
    expect(parseDate('15.06.2026 14:30:00')).toBe('2026-06-15T09:30:00.000Z')
    expect(parseDate('15.06.2026 14:30')).toBe('2026-06-15T09:30:00.000Z')
  })

  it('returns null for empty / malformed / impossible / nullish', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate('not a date')).toBeNull()
    expect(parseDate('32.13.2026')).toBeNull()
    expect(parseDate(null)).toBeNull()
  })
})
