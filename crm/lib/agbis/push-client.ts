import { createAdminClient } from '@/lib/supabase/admin'
import { contragForAll } from './write-commands'

/**
 * Ensure a CRM client is linked to an Agbis contragent — prerequisite for pushing an order.
 * Idempotent and dedupe-aware (B13/B14): (1) already linked → return it; (2) another CRM client
 * with the same phone is already linked → reuse that contr_id (no new contragent); (3) otherwise
 * ContragForAll, which itself dedupes server-side by phone and reports WasNew. Writes use the
 * service role (clients sync mirror). Agbis has no single-phone lookup command (verified live).
 */

type AdminClient = ReturnType<typeof createAdminClient>

export type EnsureClientResult =
  | { ok: true; agbisClientId: string; wasNew: boolean }
  | { ok: false; reason: string }

async function stampClient(admin: AdminClient, clientId: string, agbisClientId: string): Promise<void> {
  await admin
    .from('clients')
    .update({
      agbis_client_id: agbisClientId,
      sync_status: 'synced',
      sync_error: null,
      agbis_synced_at: new Date().toISOString(),
    })
    .eq('id', clientId)
}

export async function ensureClientInAgbis(clientId: string): Promise<EnsureClientResult> {
  const admin = createAdminClient()
  const { data: client } = await admin
    .from('clients')
    .select('id, name, phone, address, agbis_client_id')
    .eq('id', clientId)
    .single()
  if (!client) return { ok: false, reason: 'client_not_found' }
  if (client.agbis_client_id) return { ok: true, agbisClientId: client.agbis_client_id, wasNew: false }
  if (!client.phone) return { ok: false, reason: 'client_phone_missing' }

  // CRM-side dedupe: an already-linked client with the same phone → reuse its Agbis id.
  const { data: dups } = await admin
    .from('clients')
    .select('agbis_client_id')
    .eq('phone', client.phone)
    .neq('id', clientId)
    .not('agbis_client_id', 'is', null)
    .limit(1)
  const dupId = dups?.[0]?.agbis_client_id
  if (dupId) {
    await stampClient(admin, clientId, dupId)
    return { ok: true, agbisClientId: dupId, wasNew: false }
  }

  try {
    const { contrId, wasNew } = await contragForAll({
      name: client.name,
      fullname: client.name,
      telephCell: client.phone,
      address: client.address,
    })
    await stampClient(admin, clientId, contrId)
    return { ok: true, agbisClientId: contrId, wasNew }
  } catch (err) {
    console.error('[agbis.ensureClient]', err)
    return { ok: false, reason: 'contrag_failed' }
  }
}
