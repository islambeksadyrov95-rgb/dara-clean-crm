'use server'

import { createAdminClient } from '@/lib/supabase/admin'

export type ClientRow = {
  name: string
  phone: string
  address: string | null
  total_orders: number
  total_spent: number
  avg_order_value: number
  last_order_date: string | null // ISO date
}

export type ImportResult = {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

const BATCH_SIZE = 500

export async function importClients(
  clients: ClientRow[]
): Promise<ImportResult> {
  const supabase = createAdminClient()

  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  // Пакетный upsert
  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const batch = clients.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('clients')
      .upsert(
        batch.map((c) => ({
          name: c.name,
          phone: c.phone,
          address: c.address,
          total_orders: c.total_orders,
          total_spent: c.total_spent,
          avg_order_value: c.avg_order_value,
          last_order_date: c.last_order_date,
        })),
        { onConflict: 'phone', ignoreDuplicates: false }
      )
      .select('created_at, updated_at')

    if (error) {
      result.errors.push(`Пакет ${i / BATCH_SIZE + 1}: ${error.message}`)
      result.skipped += batch.length
      continue
    }

    // Supabase upsert не разделяет created/updated напрямую.
    // Если created_at === updated_at — новая запись, иначе обновление.
    // Но при upsert updated_at обновляется триггером, а created_at нет.
    // Поэтому считаем по разнице.
    if (data) {
      for (const row of data) {
        // При insert: created_at и updated_at выставляются одновременно (now())
        // При update: updated_at обновляется триггером, created_at остаётся старым
        const created = new Date(row.created_at)
        const updated = new Date(row.updated_at)
        // Разница < 1 секунды — считаем новой записью
        if (Math.abs(updated.getTime() - created.getTime()) < 1000) {
          result.created++
        } else {
          result.updated++
        }
      }
    }
  }

  return result
}
