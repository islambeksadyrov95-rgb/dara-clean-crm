/**
 * Date formatting between CRM (ISO / HTML inputs) and Agbis (dd.mm.yyyy[ HH:MM:SS], Almaty).
 * Almaty is a fixed UTC+5 offset (no DST) per database.md — so a literal '+05:00' is safe and the
 * wall-clock the manager picks round-trips exactly. Pure functions (unit-tested); no I/O.
 */

export const ALMATY_OFFSET = '+05:00'
const ALMATY_TZ = 'Asia/Almaty'

const YMD_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/
const YMD_HM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/**
 * Intake date → "16.06.2026" for Agbis doc_date (date only — Agbis stamps doc_time itself on create;
 * there is no write field for intake time). Accepts both "2026-06-16" and "2026-06-16T17:42".
 * Returns null on malformed input.
 */
export function intakeDateToAgbis(value: string): string | null {
  const m = YMD_PREFIX.exec(value)
  if (!m) return null
  return `${m[3]}.${m[2]}.${m[1]}`
}

/** "2026-06-18T14:30" (datetime-local) → ISO with Almaty offset for storage. Null on malformed. */
export function deliveryLocalToISO(local: string): string | null {
  const m = YMD_HM.exec(local)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${ALMATY_OFFSET}`
}

/** Stored ISO timestamptz → "18.06.2026 14:30:00" (Almaty wall-clock) for Agbis date_out. */
export function deliveryISOToAgbis(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: ALMATY_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('day')}.${get('month')}.${get('year')} ${hour}:${get('minute')}:${get('second')}`
}

/** Almaty calendar date today as "YYYY-MM-DD" — the default value for the intake date input. */
export function almatyTodayYMD(now: Date = new Date()): string {
  // en-CA locale already yields YYYY-MM-DD for the given timezone.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Current Almaty wall-clock as "YYYY-MM-DDTHH:mm" — the default for the intake datetime-local input. */
export function almatyNowLocal(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

const DAY_MS = 86_400_000

/** Almaty wall-clock "YYYY-MM-DDTHH:mm" for now + N days — for the «выдача +3/+4/+5 дней» buttons. */
export function almatyNowPlusDaysLocal(days: number, now: Date = new Date()): string {
  return almatyNowLocal(new Date(now.getTime() + days * DAY_MS))
}

/** Stored ISO timestamptz → "16.06.2026 17:42" (Almaty wall-clock) for display. Null in → null. */
export function formatAlmatyDateTime(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: ALMATY_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('day')}.${get('month')}.${get('year')} ${hour}:${get('minute')}`
}
