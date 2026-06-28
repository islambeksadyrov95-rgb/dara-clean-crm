import { z } from 'zod'
import { isKnownWarehouse } from '@/lib/agbis/order-config'
import { TRIP_KINDS } from '@/lib/agbis/order-trips'
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

/**
 * Trip arm — Забор (pickup) and Выдача (delivery) are two independent legs (Wave 1). Each is
 * self (самовывоз, no trip) or trip (выезд with address + car). Район и окно времени убраны
 * (D-2026-06-16): Agbis получает дефолтное окно server-side. The Agbis tp is fixed by the arm
 * (pickup→tp1, delivery→tp2), not chosen by the user — see lib/agbis/order-trips.ts.
 */
export const TRIP_MODES = ['self', 'trip'] as const
export type TripMode = (typeof TRIP_MODES)[number]

export const TripArmSchema = z.object({
  mode: z.enum(TRIP_MODES).default('self'),
  address: z.string().max(300).optional(),
  carId: z.string().max(20).optional(),
})
export type TripArmInput = z.infer<typeof TripArmSchema>

/**
 * Order-level discount — PERCENT only (D-2026-06-16). Agbis stores a per-service discount in % only
 * (no fixed-₸ discount field), so a % is the единственный способ держать скидку идентичной в CRM и
 * Agbis: тот же % применяется к авторитетной цене Agbis. ₸-режим убран (его нельзя точно отразить).
 * Returns the clamped integer percent + the whole-tenge amount (Math.round — database.md). Pure.
 */
export function computeDiscount(subtotal: number, percent: number): { percent: number; amount: number } {
  const p = Math.min(Math.max(Math.round(percent), 0), 100)
  if (subtotal <= 0 || p <= 0) return { percent: 0, amount: 0 }
  return { percent: p, amount: Math.round((subtotal * p) / 100) }
}

export const CreateOrderSchema = z
  .object({
    clientId: z.string().uuid(),
    items: z.array(OrderItemSchema).max(100).default([]),
    carpets: z.array(CarpetItemSchema).max(100).default([]),
    scladId: z.string().refine(isKnownWarehouse, { message: 'Неизвестный склад' }),
    scladOutId: z.string().refine(isKnownWarehouse, { message: 'Неизвестный склад выдачи' }),
    comment: z.string().max(500).optional(),
    intakeDate: z.string().regex(YMD_HM_RE).optional(), // дата+время приёма; default = now Almaty (action)
    deliveryAt: z.string().regex(YMD_HM_RE).optional(), // дата+время выдачи (datetime-local)
    fastExecId: z.string().max(10).optional(), // Agbis order_times id
    // Скидка на заказ — процент (0–100); server считает amount от своего subtotal. Только % (см. computeDiscount).
    discountPercent: z.number().min(0).max(100).default(0),
    // Идемпотентность создания: ключ генерится один раз при открытии формы. Повторный submit (ретрай
    // после таймаута/ошибки) с тем же ключом возвращает ТОТ ЖЕ заказ, не создаёт дубль. D-2026-06-28-idempotency.
    idempotencyKey: z.string().uuid().optional(),
    // Два независимых плеча выезда (Wave 1). Забор → Agbis tp=1, Выдача → tp=2. Каждое self|trip.
    pickup: TripArmSchema.default({ mode: 'self' }),
    delivery: TripArmSchema.default({ mode: 'self' }),
  })
  .superRefine((v, ctx) => {
    if (v.items.length === 0 && v.carpets.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Добавьте хотя бы одну позицию' })
    }
    for (const kind of TRIP_KINDS) {
      const arm = v[kind]
      if (arm.mode !== 'trip') continue
      if (!arm.address) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [kind, 'address'], message: 'Укажите адрес выезда' })
      if (!arm.carId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [kind, 'carId'], message: 'Выберите машину' })
    }
  })

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type OrderItemInput = z.infer<typeof OrderItemSchema>
export type CarpetItemInput = z.infer<typeof CarpetItemSchema>

/** Wave 2 edit: reconcile an existing order's two trip arms (self|trip each). Same arm rules as create. */
export const UpdateOrderTripsSchema = z
  .object({
    orderId: z.string().uuid(),
    pickup: TripArmSchema.default({ mode: 'self' }),
    delivery: TripArmSchema.default({ mode: 'self' }),
    intakeDate: z.string().regex(YMD_HM_RE).optional(), // забор дата+время (datetime-local)
    deliveryAt: z.string().regex(YMD_HM_RE).optional(), // выдача дата+время (datetime-local)
  })
  .superRefine((v, ctx) => {
    for (const kind of TRIP_KINDS) {
      const arm = v[kind]
      if (arm.mode !== 'trip') continue
      if (!arm.address) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [kind, 'address'], message: 'Укажите адрес выезда' })
      if (!arm.carId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [kind, 'carId'], message: 'Выберите машину' })
    }
  })
export type UpdateOrderTripsInput = z.infer<typeof UpdateOrderTripsSchema>

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
