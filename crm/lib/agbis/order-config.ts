/**
 * Order-write constants for Agbis. Values verified live 2026-06-16 against 764 May-2026
 * orders: every order uses price_list 0 and sclad_id == sclad_to (mobile vans dominate;
 * "Машина 2"/1023 is most-used). Status 1 = новый. See memory: agbis-orders-facts.
 *
 * Warehouses are a small, stable set sourced from ReceptionCenters (2026-06-16). When the
 * read-sync caches them into a table, replace this constant with a DB read.
 */

export const AGBIS_PRICE_ID = '0' // single retail price list ("Розничная")
export const AGBIS_NEW_STATUS_ID = 1 // новый
export const AGBIS_NEW_STATUS_NAME = 'Новый'
export const AGBIS_DEFAULT_SCLAD_ID = '1023' // Машина 2 — most-used intake/output

export type AgbisWarehouse = { id: string; name: string }

// Intake == output on real orders, so one selector drives both sclad_id and sclad_out_id.
export const AGBIS_WAREHOUSES: readonly AgbisWarehouse[] = [
  { id: '1023', name: 'Машина 2' },
  { id: '1032', name: 'Машина 1' },
  { id: '1033', name: 'Машина 3' },
  { id: '1004', name: 'Машина 4' },
  { id: '1', name: 'Сайрам 2' },
  { id: '1022', name: 'Орманова 117а' },
] as const

const WAREHOUSE_IDS = new Set(AGBIS_WAREHOUSES.map((w) => w.id))

export function isKnownWarehouse(id: string): boolean {
  return WAREHOUSE_IDS.has(id)
}
