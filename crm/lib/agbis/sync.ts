import { createAdminClient } from '@/lib/supabase/admin'
import { priceList, type AgbisPriceItem } from './commands'

/**
 * Catalog sync: pull the Agbis price list (no-session) and upsert it into
 * agbis_price_items (service role). Refreshes agbis_sync_state('catalog').
 * Idempotent: upsert keyed on agbis_tovar_id. Errors are logged as state and
 * surfaced as a generic message (R1 — never leak DB internals to the caller).
 */

export type CatalogSyncResult = { fetched: number; upserted: number }

function toRow(item: AgbisPriceItem) {
  return {
    agbis_tovar_id: item.tovarId,
    code: item.code,
    name: item.name,
    unit: item.unit,
    price: item.price ?? 0, // column is NOT NULL DEFAULT 0
    tovar_type: item.tovarType,
    group_name: item.groupName,
    top_parent: item.topParent,
    order_addon_pack_id: item.orderAddonPackId,
    is_price_editable: item.isPriceEditable,
    price_id: item.priceId,
    is_active: true,
    synced_at: new Date().toISOString(),
  }
}

async function markSyncState(status: 'ok' | 'error', error: string | null): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  await admin.from('agbis_sync_state').upsert({
    entity: 'catalog',
    last_run_at: now,
    last_synced_at: status === 'ok' ? now : undefined,
    last_status: status,
    last_error: error,
    updated_at: now,
  })
}

export async function syncCatalog(priceId = '0'): Promise<CatalogSyncResult> {
  const items = await priceList(priceId)

  if (items.length === 0) {
    await markSyncState('ok', null)
    return { fetched: 0, upserted: 0 }
  }

  const rows = items.map(toRow)
  const admin = createAdminClient()
  const { error } = await admin
    .from('agbis_price_items')
    .upsert(rows, { onConflict: 'agbis_tovar_id' })

  if (error) {
    console.error('[agbis.syncCatalog] upsert failed:', error.message)
    await markSyncState('error', error.message)
    throw new Error('Не удалось сохранить каталог Agbis')
  }

  await markSyncState('ok', null)
  return { fetched: items.length, upserted: rows.length }
}
