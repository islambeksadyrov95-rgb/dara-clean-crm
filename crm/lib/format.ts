/**
 * Shared display formatters (R11 — used across order form, order page, /orders).
 * Money is whole tenge (integer). ru-RU grouping uses a non-breaking space; we normalize it to a
 * regular space so output is stable and predictable across environments.
 */

const NBSP = String.fromCharCode(160)

export function fmtTenge(wholeTenge: number): string {
  const grouped = wholeTenge.toLocaleString('ru-RU').split(NBSP).join(' ')
  return `${grouped} ₸`
}
