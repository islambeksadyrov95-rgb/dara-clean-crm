import { z } from 'zod'
import { isKnownWarehouse } from '@/lib/agbis/order-config'
import {
  CARPET_TOVAR_ID, computeArea, buildCarpetFigure, buildCarpetAddons, estimateCarpetPrice,
  type CarpetAddon,
} from '@/lib/agbis/carpet'

/**
 * Pure validation + shaping for order creation. Lives outside actions.ts because a 'use server'
 * module may only export async functions — schema/helpers are imported there. Money is whole
 * tenge (integer). Discounts are not computed in CRM (D1: Agbis is authoritative). Carpets
 * (editable price): CRM shows an ESTIMATE (area × price-per-m²); Agbis stays authoritative for the
 * real price. The carpet line is sent to Agbis with addons {Тип ковра, Площадь}; qty/count = area.
 */

export const OrderItemSchema = z.object({
  tovarId: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
})

export const CarpetItemSchema = z
  .object({
    typeStrId: z.string().min(1),
    typeName: z.string().min(1),
    pricePerM2: z.number().int().nonnegative(),
    shapeFlt: z.string().min(1),
    dim1: z.number().positive(),
    dim2: z.number().nonnegative(),
  })
  .refine((c) => computeArea(c.shapeFlt, c.dim1, c.dim2) > 0, { message: 'Укажите размеры ковра' })

const YMD_HM_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export const DELIVERY_TYPES = ['self', 'pickup', 'dropoff'] as const
export type DeliveryType = (typeof DELIVERY_TYPES)[number]

export const DISCOUNT_MODES = ['percent', 'amount'] as const
export type DiscountMode = (typeof DISCOUNT_MODES)[number]

/**
 * Order-level discount from manager input. percent → applied to subtotal; amount → ₸ off (clamped).
 * Returns whole-tenge amount + an integer percent (Agbis takes a per-service discount in %).
 * Money: Math.round after each step (database.md). Pure — unit-tested.
 */
export function computeDiscount(
  subtotal: number,
  mode: DiscountMode,
  value: number,
): { percent: number; amount: number } {
  if (subtotal <= 0 || value <= 0) return { percent: 0, amount: 0 }
  if (mode === 'percent') {
    const percent = Math.min(Math.round(value), 100)
    return { percent, amount: Math.round((subtotal * percent) / 100) }
  }
  const amount = Math.min(Math.round(value), subtotal)
  return { percent: Math.round((amount / subtotal) * 100), amount }
}

export const CreateOrderSchema = z
  .object({
    clientId: z.string().uuid(),
    items: z.array(OrderItemSchema).max(100).default([]),
    carpets: z.array(CarpetItemSchema).max(100).default([]),
    scladId: z.string().refine(isKnownWarehouse, { message: 'Неизвестный склад' }),
    comment: z.string().max(500).optional(),
    intakeDate: z.string().regex(YMD_HM_RE).optional(), // дата+время приёма; default = now Almaty (action)
    deliveryAt: z.string().regex(YMD_HM_RE).optional(), // дата+время выдачи (datetime-local)
    fastExecId: z.string().max(10).optional(), // Agbis order_times id
    // Скидка на заказ: режим (% или ₸) + значение; server считает percent+amount от своего subtotal.
    discountMode: z.enum(DISCOUNT_MODES).default('percent'),
    discountValue: z.number().nonnegative().max(100_000_000).default(0),
    // Выезд/самовывоз (Wave 3). self = самовывоз (no trip); pickup/dropoff = выезд.
    // Район и окно времени убраны из формы (D-2026-06-16): Agbis получает дефолтное окно server-side.
    deliveryType: z.enum(DELIVERY_TYPES).default('self'),
    deliveryAddress: z.string().max(300).optional(),
    carId: z.string().max(20).optional(), // Agbis Cars.id
  })
  .superRefine((v, ctx) => {
    if (v.items.length === 0 && v.carpets.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Добавьте хотя бы одну позицию' })
    }
    if (v.deliveryType === 'self') return
    const required: [keyof typeof v, string][] = [
      ['deliveryAddress', 'Укажите адрес выезда'],
      ['carId', 'Выберите машину'],
    ]
    for (const [field, message] of required) {
      if (!v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message })
    }
  })

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type OrderItemInput = z.infer<typeof OrderItemSchema>
export type CarpetItemInput = z.infer<typeof CarpetItemSchema>

export type RpcOrderItem = {
  agbis_tovar_id: string
  name: string
  qty: number
  kfx: number
  unit_price: number
  line_amount: number
  discount_percent: number
  addons?: CarpetAddon[]
}

export function buildOrderItems(items: readonly OrderItemInput[]): RpcOrderItem[] {
  return items.map((it) => ({
    agbis_tovar_id: it.tovarId,
    name: it.name,
    qty: it.qty,
    kfx: 1,
    unit_price: it.unitPrice,
    line_amount: Math.round(it.qty * it.unitPrice),
    discount_percent: 0,
  }))
}

export function buildCarpetItems(carpets: readonly CarpetItemInput[]): RpcOrderItem[] {
  return carpets.map((c) => {
    const area = computeArea(c.shapeFlt, c.dim1, c.dim2)
    const figure = buildCarpetFigure(c.shapeFlt, c.dim1, c.dim2)
    return {
      agbis_tovar_id: CARPET_TOVAR_ID,
      name: `Ковер (${c.typeName}, ${area} м²)`,
      qty: 1,
      kfx: area,
      unit_price: c.pricePerM2,
      line_amount: estimateCarpetPrice(area, c.pricePerM2),
      discount_percent: 0,
      addons: buildCarpetAddons(c.typeStrId, figure),
    }
  })
}

export function sumLineAmounts(items: readonly RpcOrderItem[]): number {
  return items.reduce((sum, it) => sum + it.line_amount, 0)
}
