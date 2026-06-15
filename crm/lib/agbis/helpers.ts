/**
 * Pure helpers for the Agbis API protocol. No I/O — unit-tested in helpers.test.ts.
 *
 * Agbis gotchas these encode:
 * - Request: the whole JSON param is URL-encoded EXACTLY ONCE (double-encoding → error 1).
 * - Response: every string value is URL-encoded (`%2B`=+, `+`/`%20`=space) → decode recursively.
 * - Money: comes as a string with a decimal COMMA ("801,93") and space thousand-separators.
 *   CRM stores whole tenge (integer) — round.
 * - Dates: "dd.mm.yyyy[ HH:MM[:SS]]". Treated as Almaty local (UTC+5).
 */

const ALMATY_OFFSET = '+05:00'

/** encodeURIComponent of the JSON literal — once, over the whole param string. */
export function enc(params: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(params))
}

/** Recursively URL-decode every string in a parsed response (`+`→space, `%XX`→char). */
export function decodeAll<T>(value: T): T {
  if (typeof value === 'string') {
    try {
      return decodeURIComponent(value.replace(/\+/g, ' ')) as unknown as T
    } catch {
      return value // malformed % sequence — leave as-is rather than throw
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeAll(item)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) out[key] = decodeAll(val)
    return out as unknown as T
  }
  return value
}

/** Agbis money string ("801,93" / "12 800,50") → integer whole tenge, or null if absent/invalid. */
export function money(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  if (cleaned === '') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

/** Agbis date "dd.mm.yyyy[ HH:MM[:SS]]" (Almaty UTC+5) → UTC ISO string, or null. */
export function parseDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = raw
    .trim()
    .match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return null
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = match
  const date = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${ALMATY_OFFSET}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
