import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  upsertError: null as { message: string } | null,
  upsertArg: null as unknown,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({ neq: async () => ({ data: [], error: null }) }),
      upsert: async (rows: unknown) => {
        state.upsertArg = rows
        return { error: state.upsertError }
      },
    }),
  }),
}))

import { saveSalesPlans } from '@/app/(protected)/sales-plans/actions'

beforeEach(() => {
  state.user = null
  state.upsertError = null
  state.upsertArg = null
})

describe('saveSalesPlans — auth', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await saveSalesPlans(6, 2026, [])
    expect(res.success).toBe(false)
    expect(state.upsertArg).toBeNull()
  })

  it('rejects non-admin managers', async () => {
    state.user = { id: 'u1', app_metadata: { role: 'manager' } }
    const res = await saveSalesPlans(6, 2026, [])
    expect(res.success).toBe(false)
    expect(state.upsertArg).toBeNull()
  })

  it('allows admin and forwards plan rows to upsert', async () => {
    state.user = { id: 'admin1', app_metadata: { role: 'admin' } }
    const res = await saveSalesPlans(6, 2026, [
      {
        managerId: 'm1',
        carpetsTarget: 100,
        furnitureTarget: 0,
        curtainsTarget: 0,
        repeatTarget: 0,
        dryCleanTarget: 0,
        blanketsTarget: 0,
      },
    ])
    expect(res.success).toBe(true)
    expect(Array.isArray(state.upsertArg)).toBe(true)
    expect((state.upsertArg as Array<{ manager_id: string }>)[0].manager_id).toBe('m1')
  })
})
