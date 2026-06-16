/**
 * Date-window helpers for the Agbis *ByDateTimeForAll sync reads.
 *
 * Two distinct date concepts — DO NOT mix them:
 * - Request bounds (StartDate/StopDate) — Agbis wants "dd.mm.yyyy HH:MM" in its LOCAL
 *   timezone (Almaty). We build these from calendar integers, never from a Date instant,
 *   so there is no UTC-offset drift.
 * - order_date — a CALENDAR date (yyyy-mm-dd). Agbis sends "dd.mm.yyyy". We reformat the
 *   string directly; converting through `new Date(...+05:00)` would shift the day for
 *   midnight-local orders. (This is the timezone trap order_history matching depends on.)
 */

export type DateWindow = { start: string; stop: string }

const ALMATY_TZ = 'Asia/Almaty'
const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Days in a given month (1-based month). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Agbis "dd.mm.yyyy[ HH:MM[:SS]]" → calendar "yyyy-mm-dd", or null. No timezone math. */
export function agbisDateToYmd(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (!match) return null
  const [, dd, mm, yyyy] = match
  return `${yyyy}-${mm}-${dd}`
}

/** Calendar parts → Agbis request bound "dd.mm.yyyy HH:MM". */
function bound(year: number, month: number, day: number, hh: number, mi: number): string {
  return `${pad2(day)}.${pad2(month)}.${year} ${pad2(hh)}:${pad2(mi)}`
}

function parseYmd(ymd: string): { year: number; month: number } | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]) }
}

/**
 * Tile [startYmd, endYmd] into half-month windows (1–15 and 16–end of each month).
 * Windows are inclusive "dd.mm.yyyy 00:00" → "dd.mm.yyyy 23:59" Almaty-local bounds.
 * Used for the one-time backfill — small overlaps are harmless (sync is idempotent).
 */
export function generateHalfMonthWindows(startYmd: string, endYmd: string): DateWindow[] {
  const start = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  if (!start || !end) return []

  const windows: DateWindow[] = []
  let year = start.year
  let month = start.month

  while (year < end.year || (year === end.year && month <= end.month)) {
    const last = daysInMonth(year, month)
    for (const [from, to] of [[1, 15], [16, last]] as const) {
      windows.push({
        start: bound(year, month, from, 0, 0),
        stop: bound(year, month, to, 23, 59),
      })
    }
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return windows
}

/** ISO instant → Almaty-local calendar parts (for incremental request bounds). */
function isoToAlmatyParts(
  iso: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '00' : parts.hour),
    minute: Number(parts.minute),
  }
}

/**
 * A single incremental window: from the last cursor (ISO instant) to now.
 * `nowIso` is injected (deterministic tests; some sandboxes block argless Date.now()).
 */
export function incrementalWindow(sinceIso: string, nowIso: string): DateWindow | null {
  const since = isoToAlmatyParts(sinceIso)
  const now = isoToAlmatyParts(nowIso)
  if (!since || !now) return null
  return {
    start: bound(since.year, since.month, since.day, since.hour, since.minute),
    stop: bound(now.year, now.month, now.day, now.hour, now.minute),
  }
}
