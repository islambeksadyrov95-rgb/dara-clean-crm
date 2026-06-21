import { z } from 'zod'

/**
 * Pure Zod schema for the cancelOrder server action (lives outside the 'use server' actions module,
 * which may only export async functions). reason = RETURN_KIND_ID (7 «Отказ клиента», 8 «Ошибка
 * оформления») — совпадает с CHECK на orders.cancel_reason и CANCEL_REASONS в order-status.ts.
 */
export const CancelOrderSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.union([z.literal(7), z.literal(8)]),
  comment: z.string().max(500).nullable().optional(),
})

export type CancelOrderInput = z.infer<typeof CancelOrderSchema>
