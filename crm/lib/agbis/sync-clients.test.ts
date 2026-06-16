import { describe, it, expect } from 'vitest'
import { classifyClients, type ExistingClient } from '@/lib/agbis/sync-clients'
import type { AgbisSyncClient } from '@/lib/agbis/sync-types'

const NOW = '2026-06-16T00:00:00.000Z'

function client(over: Partial<AgbisSyncClient> & { contrId: string }): AgbisSyncClient {
  return {
    contrId: over.contrId,
    fullname: over.fullname ?? 'Иванов Иван',
    name: over.name ?? 'Иванов И.',
    telephone: null,
    telephCell: over.telephCell ?? '+77001234567',
    email: null,
    address: over.address ?? 'Алматы',
    gender: null,
    isActive: true,
    isDeleted: over.isDeleted ?? false,
    orderCount: null,
    bonus: null,
    deposit: null,
    dolg: null,
    paySumm: null,
    firstOrderDate: null,
    lastOrderDate: null,
  }
}

function classify(clients: AgbisSyncClient[], existing: [string, ExistingClient][] = [], managers: string[] = ['m1', 'm2']) {
  return classifyClients({
    clients,
    existingByPhone: new Map(existing),
    managerIds: managers,
    nowIso: NOW,
  })
}

describe('classifyClients', () => {
  it('links an existing unlinked client by phone WITHOUT overwriting CRM name/address', () => {
    const existing: [string, ExistingClient] = [
      '+77001234567',
      { id: 'crm-1', name: 'CRM Имя', address: 'CRM Адрес', agbisClientId: null },
    ]
    const r = classify([client({ contrId: '500', fullname: 'Agbis Имя', address: 'Agbis Адрес' })], [existing])
    expect(r.newRows).toEqual([])
    expect(r.linkRows).toEqual([
      {
        phone: '+77001234567',
        name: 'CRM Имя', // preserved — CRM is source of truth
        address: 'CRM Адрес',
        agbis_client_id: '500',
        agbis_synced_at: NOW,
        sync_status: 'synced',
      },
    ])
  })

  it('creates a new client (round-robin manager) when no CRM client shares the phone', () => {
    const r = classify([
      client({ contrId: '1', telephCell: '+77000000001' }),
      client({ contrId: '2', telephCell: '+77000000002' }),
      client({ contrId: '3', telephCell: '+77000000003' }),
    ])
    expect(r.newRows.map((n) => n.assigned_manager_id)).toEqual(['m1', 'm2', 'm1'])
    expect(r.newRows[0]).toMatchObject({
      agbis_client_id: '1',
      sync_status: 'synced',
      name: 'Иванов Иван',
    })
  })

  it('quarantines Agbis test cards 1022/10013/10014', () => {
    const r = classify([client({ contrId: '1022' }), client({ contrId: '10013' }), client({ contrId: '10014', telephCell: '+77009999999' })])
    expect(r.newRows).toEqual([])
    expect(r.quarantine.map((q) => q.reason)).toEqual(['test_card', 'test_card', 'test_card'])
  })

  it('quarantines clients without a valid +7 phone', () => {
    const r = classify([client({ contrId: '7', telephCell: '+1202555' })])
    expect(r.quarantine).toEqual([{ contrId: '7', phone: null, reason: 'no_phone' }])
  })

  it('quarantines the second client when two share a normalized phone (many-to-one)', () => {
    const r = classify([
      client({ contrId: '10', telephCell: '+7 700 123 45 67' }),
      client({ contrId: '11', telephCell: '87001234567' }), // same last-10 → same +7…
    ])
    expect(r.newRows).toHaveLength(1)
    expect(r.quarantine).toEqual([{ contrId: '11', phone: '+77001234567', reason: 'dup_phone' }])
  })

  it('is idempotent: a client already linked to the same contr_id re-links (no new client)', () => {
    const existing: [string, ExistingClient] = [
      '+77001234567',
      { id: 'crm-1', name: 'X', address: null, agbisClientId: '500' },
    ]
    const r = classify([client({ contrId: '500' })], [existing])
    expect(r.newRows).toEqual([])
    expect(r.linkRows).toHaveLength(1)
    expect(r.quarantine).toEqual([])
  })

  it('quarantines when the CRM client is already linked to a DIFFERENT contr_id', () => {
    const existing: [string, ExistingClient] = [
      '+77001234567',
      { id: 'crm-1', name: 'X', address: null, agbisClientId: '999' },
    ]
    const r = classify([client({ contrId: '500' })], [existing])
    expect(r.quarantine).toEqual([{ contrId: '500', phone: '+77001234567', reason: 'crm_linked_other' }])
  })

  it('dedupes the same contr_id appearing twice in one window', () => {
    const r = classify([client({ contrId: '1', telephCell: '+77000000001' }), client({ contrId: '1', telephCell: '+77000000001' })])
    expect(r.newRows).toHaveLength(1)
  })
})
