'use server'

import { z } from 'zod'
import { tripsHr } from '@/lib/agbis/trips'
import { intakeDateToAgbis } from '@/lib/agbis/order-dates'

/**
 * Free trip START-hour slots for a (date, car), for the order form's выезд section. The end hour
 * is derived client-side (deriveEndOptions) since TripsHrTo is unreliable. Input validated (R2),
 * errors generic (R1).
 */

const TripSlotsSchema = z.object({
  dateYMD: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  carId: z.string().min(1).max(20),
})

export async function getTripSlots(
  rawInput: unknown,
): Promise<{ success: true; slots: string[] } | { success: false; error: string }> {
  const parsed = TripSlotsSchema.safeParse(rawInput)
  if (!parsed.success) return { success: false, error: 'Некорректная дата или машина' }

  const date = intakeDateToAgbis(parsed.data.dateYMD)
  if (!date) return { success: false, error: 'Некорректная дата' }

  try {
    const slots = await tripsHr(date, parsed.data.carId)
    return { success: true, slots }
  } catch (err) {
    console.error('[order.getTripSlots]', err)
    return { success: false, error: 'Не удалось загрузить слоты выезда' }
  }
}
