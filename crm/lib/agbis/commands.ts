import { z } from 'zod'
import { agbisCall } from './client'
import { money } from './helpers'

/**
 * Typed Agbis command wrappers. Responses are already URL-decoded by the client.
 * PriceList is a no-session reference command (catalog), so no SessionID is needed.
 */

export type AgbisPriceItem = {
  tovarId: string // PriceList `id` → maps to agbis_price_items.agbis_tovar_id
  code: string | null
  name: string
  unit: string | null
  price: number | null // whole tenge
  tovarType: number | null // 1 товар, 2 услуга
  groupName: string | null
  topParent: string | null
  orderAddonPackId: string | null
  isPriceEditable: boolean
  priceId: string
}

const StrNum = z.union([z.string(), z.number()])

const RawPriceItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().optional(),
    unit: z.string().optional(),
    price: StrNum.optional(),
    tovar_type: StrNum.optional(),
    group_c: z.string().optional(),
    top_parent: z.string().optional(),
    order_addon_pack_id: z.string().optional(),
    is_price_editable: z.union([z.string(), z.number(), z.boolean()]).optional(),
    price_id: StrNum.optional(),
  })
  .passthrough()

function toInt(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function toBool(value: unknown): boolean {
  return value === '1' || value === 1 || value === true
}

export function mapPriceItem(raw: unknown): AgbisPriceItem | null {
  const parsed = RawPriceItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  return {
    tovarId: item.id,
    code: item.code ?? null,
    name: item.name,
    unit: item.unit ?? null,
    price: money(item.price),
    tovarType: toInt(item.tovar_type),
    groupName: item.group_c ?? null,
    topParent: item.top_parent ?? null,
    orderAddonPackId: item.order_addon_pack_id ?? null,
    isPriceEditable: toBool(item.is_price_editable),
    priceId: item.price_id != null ? String(item.price_id) : '0',
  }
}

/** PriceList (no-session) → typed catalog items, invalid rows dropped. */
export async function priceList(priceId = '0'): Promise<AgbisPriceItem[]> {
  const res = await agbisCall('PriceList', { params: { price_id: priceId } })
  const list = Array.isArray(res.price_list) ? res.price_list : []
  return list.map(mapPriceItem).filter((item): item is AgbisPriceItem => item !== null)
}
