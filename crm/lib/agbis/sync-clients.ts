import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import type { AgbisSyncClient } from './sync-types'

/**
 * Client sync (read side, free of tariff). Links the CRM client base to Agbis by phone and
 * imports Agbis-only clients. CRM is the source of truth (D-2026-06-15-crm-source-of-truth):
 * linking NEVER overwrites name/phone/address of an existing CRM client — it only stamps the
 * agbis_client_id + sync mirror. Idempotent: keyed on phone (existing) / agbis_client_id.
 * Classification (classifyClients) is pure and unit-tested; this module does the I/O.
 */

// Agbis test/service cards that must never enter the CRM client base.
const TEST_CARD_IDS = new Set(['1022', '10013', '10014'])
const SELECT_CHUNK = 500
const WRITE_CHUNK = 500

export type ExistingClient = {
  id: string
  name: string
  address: string | null
  agbisClientId: string | null
}

export type QuarantineReason = 'test_card' | 'no_phone' | 'dup_phone' | 'crm_linked_other'
export type QuarantineEntry = { contrId: string; phone: string | null; reason: QuarantineReason }

type ClientInsertRow = {
  phone: string
  name: string
  address: string | null
  assigned_manager_id: string | null
  agbis_client_id: string
  agbis_synced_at: string
  sync_status: 'synced'
}

type ClientLinkRow = {
  phone: string
  name: string
  address: string | null
  agbis_client_id: string
  agbis_synced_at: string
  sync_status: 'synced'
}

export type ClassifyClientsResult = {
  newRows: ClientInsertRow[]
  linkRows: ClientLinkRow[]
  quarantine: QuarantineEntry[]
}

export type SyncClientsResult = {
  created: number
  linked: number
  quarantined: number
  quarantine: QuarantineEntry[]
}

/**
 * Pure classification: decide link vs create vs quarantine for a window of Agbis clients.
 * `existingByPhone` maps normalized phone → existing CRM client (preloaded by the caller).
 */
export function classifyClients(input: {
  clients: AgbisSyncClient[]
  existingByPhone: Map<string, ExistingClient>
  managerIds: string[]
  nowIso: string
}): ClassifyClientsResult {
  const { clients, existingByPhone, managerIds, nowIso } = input
  const result: ClassifyClientsResult = { newRows: [], linkRows: [], quarantine: [] }

  const seenContrId = new Set<string>()
  const phoneToContrId = new Map<string, string>()
  let managerIndex = 0

  for (const client of clients) {
    if (TEST_CARD_IDS.has(client.contrId)) {
      result.quarantine.push({ contrId: client.contrId, phone: null, reason: 'test_card' })
      continue
    }
    if (seenContrId.has(client.contrId)) continue
    const phone = normalizePhone(client.telephCell ?? '')
    if (!phone) {
      result.quarantine.push({ contrId: client.contrId, phone: null, reason: 'no_phone' })
      continue
    }
    if (phoneToContrId.has(phone)) {
      result.quarantine.push({ contrId: client.contrId, phone, reason: 'dup_phone' })
      continue
    }
    seenContrId.add(client.contrId)
    phoneToContrId.set(phone, client.contrId)

    const existing = existingByPhone.get(phone)
    if (existing) {
      if (existing.agbisClientId && existing.agbisClientId !== client.contrId) {
        result.quarantine.push({ contrId: client.contrId, phone, reason: 'crm_linked_other' })
        continue
      }
      result.linkRows.push({
        phone,
        name: existing.name,
        address: existing.address,
        agbis_client_id: client.contrId,
        agbis_synced_at: nowIso,
        sync_status: 'synced',
      })
    } else {
      const assigned = managerIds.length > 0 ? managerIds[managerIndex % managerIds.length] : null
      if (managerIds.length > 0) managerIndex += 1
      result.newRows.push({
        phone,
        name: client.fullname ?? client.name ?? phone,
        address: client.address,
        assigned_manager_id: assigned,
        agbis_client_id: client.contrId,
        agbis_synced_at: nowIso,
        sync_status: 'synced',
      })
    }
  }

  return result
}

type AdminClient = ReturnType<typeof createAdminClient>

async function loadExistingByPhone(
  admin: AdminClient,
  phones: string[],
): Promise<Map<string, ExistingClient>> {
  const map = new Map<string, ExistingClient>()
  for (let i = 0; i < phones.length; i += SELECT_CHUNK) {
    const chunk = phones.slice(i, i + SELECT_CHUNK)
    const { data, error } = await admin
      .from('clients')
      .select('id, name, address, phone, agbis_client_id')
      .in('phone', chunk)
    if (error) {
      console.error('[agbis.syncClients] load existing failed:', error.message)
      throw new Error('Не удалось загрузить клиентов CRM')
    }
    for (const row of data ?? []) {
      map.set(row.phone, {
        id: row.id,
        name: row.name,
        address: row.address,
        agbisClientId: row.agbis_client_id,
      })
    }
  }
  return map
}

async function loadManagerIds(admin: AdminClient): Promise<string[]> {
  const { data, error } = await admin.from('profiles').select('id').neq('role', 'admin')
  if (error) {
    console.error('[agbis.syncClients] load managers failed:', error.message)
    return []
  }
  return (data ?? []).map((m) => m.id)
}

async function upsertByPhone(
  admin: AdminClient,
  rows: (ClientInsertRow | ClientLinkRow)[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK)
    const { error } = await admin.from('clients').upsert(chunk, { onConflict: 'phone' })
    if (error) {
      console.error('[agbis.syncClients] upsert failed:', error.message)
      throw new Error('Не удалось сохранить клиентов из Agbis')
    }
  }
}

/** Sync a window of Agbis clients into CRM. Read-only against Agbis (no billing). */
export async function syncClients(
  clients: AgbisSyncClient[],
  opts: { dryRun?: boolean } = {},
): Promise<SyncClientsResult> {
  const admin = createAdminClient()
  const phones = [
    ...new Set(clients.map((c) => normalizePhone(c.telephCell ?? '')).filter((p) => p !== '')),
  ]
  const existingByPhone = await loadExistingByPhone(admin, phones)
  const managerIds = await loadManagerIds(admin)

  const { newRows, linkRows, quarantine } = classifyClients({
    clients,
    existingByPhone,
    managerIds,
    nowIso: new Date().toISOString(),
  })

  if (!opts.dryRun) {
    // New clients first (insert), then link existing (update agbis mirror only).
    await upsertByPhone(admin, newRows)
    await upsertByPhone(admin, linkRows)
  }

  return {
    created: newRows.length,
    linked: linkRows.length,
    quarantined: quarantine.length,
    quarantine,
  }
}
