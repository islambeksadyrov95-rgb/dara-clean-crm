import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  contragSpy: vi.fn(),
  updateSpy: vi.fn(),
  state: {
    client: { id: 'c1', name: 'Иван', phone: '+7 700 111 22 33', address: 'ул. X', agbis_client_id: null as string | null },
    dupRow: null as { agbis_client_id: string | null } | null, // another CRM client with same phone
  },
}))

vi.mock('@/lib/agbis/write-commands', () => ({ contragForAll: h.contragSpy }))
vi.mock('@/lib/phone', () => ({ normalizePhone: (p: string) => p.replace(/\D/g, '') }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          single: async () => ({ data: h.state.client }),
          maybeSingle: async () => ({ data: h.state.client }),
          neq: () => ({ not: () => ({ limit: async () => ({ data: h.state.dupRow ? [h.state.dupRow] : [] }) }) }),
        }),
      }),
      update: (patch: unknown) => { h.updateSpy(patch); return { eq: async () => ({ error: null }) } },
    }),
  }),
}))

import { ensureClientInAgbis } from './push-client'

beforeEach(() => {
  h.state.client = { id: 'c1', name: 'Иван', phone: '+7 700 111 22 33', address: 'ул. X', agbis_client_id: null }
  h.state.dupRow = null
  h.contragSpy.mockReset().mockResolvedValue({ contrId: '5001', wasNew: true })
  h.updateSpy.mockReset()
})

describe('ensureClientInAgbis', () => {
  it('returns the existing agbis_client_id without calling Agbis', async () => {
    h.state.client.agbis_client_id = '999'
    const res = await ensureClientInAgbis('c1')
    expect(res).toEqual({ ok: true, agbisClientId: '999', wasNew: false })
    expect(h.contragSpy).not.toHaveBeenCalled()
  })

  it('reuses a linked CRM duplicate with the same phone (no new contragent)', async () => {
    h.state.dupRow = { agbis_client_id: '7777' }
    const res = await ensureClientInAgbis('c1')
    expect(res).toEqual({ ok: true, agbisClientId: '7777', wasNew: false })
    expect(h.contragSpy).not.toHaveBeenCalled()
    expect(h.updateSpy).toHaveBeenCalledWith(expect.objectContaining({ agbis_client_id: '7777' }))
  })

  it('creates a contragent in Agbis and stamps the id', async () => {
    const res = await ensureClientInAgbis('c1')
    expect(h.contragSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Иван', telephCell: '+7 700 111 22 33' }))
    expect(res).toEqual({ ok: true, agbisClientId: '5001', wasNew: true })
    expect(h.updateSpy).toHaveBeenCalledWith(expect.objectContaining({ agbis_client_id: '5001', sync_status: 'synced' }))
  })

  it('fails gracefully when the client has no phone', async () => {
    h.state.client.phone = ''
    const res = await ensureClientInAgbis('c1')
    expect(res.ok).toBe(false)
  })
})
