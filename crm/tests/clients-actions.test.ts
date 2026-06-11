import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'a1', app_metadata: { role: 'admin' } } as Record<string, unknown> | null,
  users: [] as Array<Record<string, unknown>>,
  // Последний update-запрос к clients
  lastUpdate: null as { data: Record<string, unknown>; filter: Record<string, unknown> } | null,
  updateError: null as { message: string } | null,
}))

// user-client: используется updateClientStickyNote / updateClientNextAction
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => ({
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          state.lastUpdate = { data, filter: { [col]: val } }
          return Promise.resolve({ error: state.updateError })
        },
      }),
    }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: async () => ({ data: { users: state.users }, error: null }) } },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  getUserNames,
  updateClientStickyNote,
  updateClientNextAction,
} from '@/app/(protected)/clients/actions'

const CLIENT_ID = 'client-uuid-1'

beforeEach(() => {
  state.user = { id: 'a1', app_metadata: { role: 'admin' } }
  state.users = [
    { id: 'a1', email: 'admin@dara.clean', app_metadata: { role: 'admin' }, user_metadata: { name: 'Исламбек' } },
    { id: 'm1', email: 'samal@daraclean.kz', app_metadata: { role: 'manager' }, user_metadata: { name: 'Самал' } },
  ]
  state.lastUpdate = null
  state.updateError = null
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

describe('updateClientStickyNote', () => {
  it('сохраняет заметку через user-client (RLS)', async () => {
    const res = await updateClientStickyNote(CLIENT_ID, 'Важный клиент')
    expect(res.success).toBe(true)
    expect(state.lastUpdate?.data).toEqual({ sticky_note: 'Важный клиент' })
    expect(state.lastUpdate?.filter).toEqual({ id: CLIENT_ID })
  })

  it('сохраняет null (очистка заметки)', async () => {
    const res = await updateClientStickyNote(CLIENT_ID, null)
    expect(res.success).toBe(true)
    expect(state.lastUpdate?.data).toEqual({ sticky_note: null })
  })

  it('возвращает ошибку для неавторизованного', async () => {
    state.user = null
    const res = await updateClientStickyNote(CLIENT_ID, 'note')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Не авторизован')
    expect(state.lastUpdate).toBeNull()
  })

  it('возвращает generic ошибку при DB error (не раскрывает детали)', async () => {
    state.updateError = { message: 'relation "clients" does not exist' }
    const res = await updateClientStickyNote(CLIENT_ID, 'note')
    expect(res.success).toBe(false)
    // Не должен содержать SQL-деталей
    expect(res.error).not.toContain('relation')
    expect(res.error).toBe('Ошибка при сохранении заметки')
  })
})

describe('updateClientNextAction', () => {
  const ISO_AT = '2026-07-01T10:00:00.000Z'

  it('сохраняет дату и заметку', async () => {
    const res = await updateClientNextAction(CLIENT_ID, ISO_AT, 'Перезвонить')
    expect(res.success).toBe(true)
    expect(state.lastUpdate?.data).toEqual({ next_action_at: ISO_AT, next_action_note: 'Перезвонить' })
    expect(state.lastUpdate?.filter).toEqual({ id: CLIENT_ID })
  })

  it('очищает поля при at=null и note=null', async () => {
    const res = await updateClientNextAction(CLIENT_ID, null, null)
    expect(res.success).toBe(true)
    expect(state.lastUpdate?.data).toEqual({ next_action_at: null, next_action_note: null })
  })

  it('возвращает ошибку для неавторизованного', async () => {
    state.user = null
    const res = await updateClientNextAction(CLIENT_ID, ISO_AT, 'note')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Не авторизован')
    expect(state.lastUpdate).toBeNull()
  })

  it('возвращает generic ошибку при DB error', async () => {
    state.updateError = { message: 'permission denied' }
    const res = await updateClientNextAction(CLIENT_ID, ISO_AT, 'note')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Ошибка при сохранении следующего шага')
  })
})
