'use server'

import { createClient } from '@/lib/supabase/server'
import { AGBIS_WAREHOUSES, type AgbisWarehouse } from '@/lib/agbis/order-config'

/**
 * Order-form data: the fixed-price Agbis service catalog + warehouse options.
 * v1 scope (D-2026-06-16): only non-editable-price services (tovar_type=2, price>0). Carpets and
 * other editable/area-priced items need addon/shape modeling — excluded here on purpose, not
 * silently dropped (the form shows a note). Read uses the authenticated client (catalog RLS = read all).
 */

export type CatalogService = {
  tovarId: string
  name: string
  price: number // whole tenge
  unit: string | null
  group: string
}

export type OrderFormData = {
  services: CatalogService[]
  warehouses: readonly AgbisWarehouse[]
}

export async function getOrderFormData(): Promise<
  { success: true; data: OrderFormData } | { success: false; error: string }
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agbis_price_items')
    .select('agbis_tovar_id, name, price, unit, group_name')
    .eq('tovar_type', 2)
    .eq('is_active', true)
    .eq('is_price_editable', false)
    .gt('price', 0)
    .order('group_name', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('[order.getOrderFormData]', error)
    return { success: false, error: 'Не удалось загрузить каталог услуг' }
  }

  const services: CatalogService[] = (data ?? []).map((row) => ({
    tovarId: row.agbis_tovar_id,
    name: row.name,
    price: row.price,
    unit: row.unit,
    group: row.group_name ?? 'Прочее',
  }))

  return { success: true, data: { services, warehouses: AGBIS_WAREHOUSES } }
}
