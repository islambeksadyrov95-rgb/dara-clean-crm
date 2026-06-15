import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

const h = vi.hoisted(() => ({
  upserts: {} as Record<string, unknown[]>,
  priceItemsError: null as { message: string } | null,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (rows: unknown) => {
        const arr = Array.isArray(rows) ? rows : [rows]
        h.upserts[table] = (h.upserts[table] || []).concat(arr)
        return { error: table === 'agbis_price_items' ? h.priceItemsError : null }
      },
    }),
  }),
}))
vi.mock('@/lib/agbis/commands', () => ({ priceList: vi.fn() }))

import { syncCatalog } from '@/lib/agbis/sync'
import { priceList } from '@/lib/agbis/commands'

const item = (over: Record<string, unknown> = {}) => ({
  tovarId: '500',
  code: 'K1',
  name: 'Чистка ковра',
  unit: 'м2',
  price: 1500,
  tovarType: 2,
  groupName: 'Ковры',
  topParent: 'Услуги',
  orderAddonPackId: null,
  isPriceEditable: false,
  priceId: '0',
  ...over,
})

beforeEach(() => {
  h.upserts = {}
  h.priceItemsError = null
  vi.clearAllMocks()
})

describe('syncCatalog', () => {
  it('upserts mapped catalog rows and records sync_state on success', async () => {
    ;(priceList as Mock).mockResolvedValue([item(), item({ tovarId: '501', name: 'Чистка дивана', price: 2000 })])

    const result = await syncCatalog('0')

    expect(priceList).toHaveBeenCalledWith('0')
    expect(result).toEqual({ fetched: 2, upserted: 2 })
    const rows = h.upserts['agbis_price_items'] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ agbis_tovar_id: '500', name: 'Чистка ковра', price: 1500, tovar_type: 2, price_id: '0' })
    expect(h.upserts['agbis_sync_state']?.[0]).toMatchObject({ entity: 'catalog', last_status: 'ok' })
  })

  it('coerces a null price to 0 (column is NOT NULL)', async () => {
    ;(priceList as Mock).mockResolvedValue([item({ price: null })])
    await syncCatalog()
    const rows = h.upserts['agbis_price_items'] as Array<Record<string, unknown>>
    expect(rows[0].price).toBe(0)
  })

  it('returns zero counts and does not upsert the catalog when empty', async () => {
    ;(priceList as Mock).mockResolvedValue([])
    const result = await syncCatalog()
    expect(result).toEqual({ fetched: 0, upserted: 0 })
    expect(h.upserts['agbis_price_items']).toBeUndefined()
    expect(h.upserts['agbis_sync_state']?.[0]).toMatchObject({ entity: 'catalog', last_status: 'ok' })
  })

  it('records error state and throws a generic message when the upsert fails', async () => {
    ;(priceList as Mock).mockResolvedValue([item()])
    h.priceItemsError = { message: 'db boom with table names' }
    await expect(syncCatalog()).rejects.toThrow(/каталог/i)
    await expect(syncCatalog()).rejects.not.toThrow(/db boom/)
    expect(h.upserts['agbis_sync_state']?.some((r) => (r as Record<string, unknown>).last_status === 'error')).toBe(true)
  })
})
