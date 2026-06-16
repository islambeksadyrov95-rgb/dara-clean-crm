import { z } from 'zod'

/**
 * Carpet (tov_id 100387) — area/price modeling for the editable-price «Ковер» item.
 * Decoded live 2026-06-16 (see CARPET-ADDONS-FINDINGS.md):
 *  - «Тип ковра» addon 100241 (vt8): str options carry price-per-m² in value_flt.
 *  - «Площадь» addon 100242 (vt9): shapes (Квадрат/Прямоугольник/Круг/Овал); figure string
 *    "dim1|dim2|shapeFlt|" (real order: "2|3|2|" = 2×3 rectangle).
 *  - addon payload shape (confirmed accepted live): { addon_id, values }.
 * Money is whole tenge: estimate = round(area × pricePerM2). Agbis stays authoritative for the
 * final price (set in the desktop UI / synced back) — CRM only shows the estimate (D1).
 * Pure functions; no I/O.
 */

export const CARPET_TOVAR_ID = '100387'
export const CARPET_TYPE_ADDON_ID = '100241'
export const CARPET_AREA_ADDON_ID = '100242'

// Shape figure flt values (addon 100242 str options).
const SHAPE_SQUARE = '1'
const SHAPE_RECTANGLE = '2'
const SHAPE_CIRCLE = '3'
const SHAPE_OVAL = '4'

export type CarpetType = { strId: string; name: string; pricePerM2: number }
export type CarpetShape = { shapeFlt: string; name: string }

/** Area in m² for a shape + dimensions (meters). dim2 is ignored for one-dimension shapes. */
export function computeArea(shapeFlt: string, dim1: number, dim2: number): number {
  if (dim1 <= 0) return 0
  switch (shapeFlt) {
    case SHAPE_SQUARE: return round2(dim1 * dim1)
    case SHAPE_RECTANGLE: return dim2 > 0 ? round2(dim1 * dim2) : 0
    case SHAPE_CIRCLE: return round2(Math.PI * (dim1 / 2) ** 2)
    case SHAPE_OVAL: return dim2 > 0 ? round2((Math.PI * dim1 * dim2) / 4) : 0
    default: return 0
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Agbis figure string "dim1|dim2|shapeFlt|". One-dim shapes repeat the dimension. */
export function buildCarpetFigure(shapeFlt: string, dim1: number, dim2: number): string {
  const second = shapeFlt === SHAPE_RECTANGLE || shapeFlt === SHAPE_OVAL ? dim2 : dim1
  return `${dim1}|${second}|${shapeFlt}|`
}

export type CarpetAddon = { addon_id: string; values: string }

export function buildCarpetAddons(typeStrId: string, figure: string): CarpetAddon[] {
  return [
    { addon_id: CARPET_TYPE_ADDON_ID, values: typeStrId },
    { addon_id: CARPET_AREA_ADDON_ID, values: figure },
  ]
}

export function estimateCarpetPrice(area: number, pricePerM2: number): number {
  return Math.round(area * pricePerM2)
}

const StrValue = z.object({
  id: z.union([z.string(), z.number()]),
  value_str: z.string().min(1),
  value_flt: z.union([z.string(), z.number()]).optional(),
})

function addonStrValues(res: unknown, addonId: string): z.infer<typeof StrValue>[] {
  const types = (res as { addon_types?: unknown })?.addon_types
  if (!Array.isArray(types)) return []
  const found = types.find((t) => String((t as { id?: unknown })?.id) === addonId)
  const values = (found as { addon_str_values?: unknown })?.addon_str_values
  if (!Array.isArray(values)) return []
  return values.flatMap((v) => {
    const parsed = StrValue.safeParse(v)
    return parsed.success ? [parsed.data] : []
  })
}

export function parseCarpetTypes(res: unknown): CarpetType[] {
  return addonStrValues(res, CARPET_TYPE_ADDON_ID).map((v) => ({
    strId: String(v.id),
    name: v.value_str,
    pricePerM2: Math.round(Number(String(v.value_flt ?? '0').replace(',', '.')) || 0),
  }))
}

export function parseCarpetShapes(res: unknown): CarpetShape[] {
  return addonStrValues(res, CARPET_AREA_ADDON_ID).map((v) => ({
    shapeFlt: String(v.value_flt ?? ''),
    name: v.value_str,
  }))
}
