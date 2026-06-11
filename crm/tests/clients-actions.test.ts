import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'a1', app_metadata: { role: 'admin' } } as Record<string, unknown> | null,
  users: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: async () => ({ data: { users: state.users }, error: null }) } },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getUserNames } from '@/app/(protected)/clients/actions'

beforeEach(() => {
  state.user = { id: 'a1', app_metadata: { role: 'admin' } }
  state.users = [
    { id: 'a1', email: 'admin@dara.clean', app_metadata: { role: 'admin' }, user_metadata: { name: 'Исламбек' } },
    { id: 'm1', email: 'samal@daraclean.kz', app_metadata: { role: 'manager' }, user_metadata: { name: 'Самал' } },
  ]
})

describe('getUserNames', () => {
  it('возвращает имена ВСЕХ пользователей, включая админов', async () => {
    const list = await getUserNames()
    const byId = new Map(list.map((u) => [u.id, u.name]))
    expect(byId.get('a1')).toBe('Исламбек') // админ присутствует (в отличие от getManagers)
    expect(byId.get('m1')).toBe('Самал')
    expect(list).toHaveLength(2)
  })

  it('возвращает [] для неавторизованного', async () => {
    state.user = null
    expect(await getUserNames()).toEqual([])
  })
})
