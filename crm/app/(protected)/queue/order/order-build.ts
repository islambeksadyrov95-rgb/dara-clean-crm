import { z } from 'zod'
import { isKnownWarehouse } from '@/lib/agbis/order-config'

/**
 * Pure validation + shaping for order creation. Lives outside actions.ts because a 'use server'
 * module may only export async functions — schema/helpers are imported there. Money is whole
 * tenge (integer). Discounts are not computed in CRM (D1: Agbis is authoritative); per-line
 * discount_percent stays 0 in v1.
 */

export const OrderItemSchema = z.object({
  tovarId: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
})

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const YMD_HM_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export const DELIVERY_TYPES = ['self', 'pickup', 'dropoff'] as const
export type DeliveryType = (typeof DELIVERY_TYPES)[number]

export const CreateOrderSchema = z
  .object({
    clientId: z.string().uuid(),
    items: z.array(OrderItemSchema).min(1).max(100),
    scladId: z.string().refine(isKnownWarehouse, { message: 'Неизвестный склад' }),
    comment: z.string().max(500).optional(),
    intakeDate: z.string().regex(YMD_RE).optional(), // дата приёма; default = today (action)
    deliveryAt: z.string().regex(YMD_HM_RE).optional(), // дата+время выдачи (datetime-local)
    fastExecId: z.string().max(10).optional(), // Agbis order_times id
    // Выезд/самовывоз (Wave 3). self = самовывоз (no trip); pickup/dropoff = выезд.
    deliveryType: z.enum(DELIVERY_TYPES).default('self'),
    deliveryAddress: z.string().max(300).optional(),
    regionId: z.string().max(20).optional(), // Agbis Regions.id
    carId: z.string().max(20).optional(), // Agbis Cars.id
    tripHr: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    tripHrTo: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.deliveryType === 'self') return
    const required: [keyof typeof v, string][] = [
      ['deliveryAddress', 'Укажите адрес выезда'],
      ['regionId', 'Выберите район'],
      ['carId', 'Выберите машину'],
      ['tripHr', 'Выберите время начала'],
      ['tripHrTo', 'Выберите время окончания'],
    ]
    for (const [field, message] of required) {
      if (!v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message })
    }
  })

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type OrderItemInput = z.infer<typeof OrderItemSchema>

export function computeAmount(items: readonly OrderItemInput[]): number {
  return items.reduce((sum, it) => sum + Math.round(it.qty * it.unitPrice), 0)
}

export type RpcOrderItem = {
  agbis_tovar_id: string
  name: string
  qty: number
  kfx: number
  unit_price: number
  line_amount: number
  discount_percent: number
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
