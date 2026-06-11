import { describe, it, expect, vi, beforeEach } from 'vitest'

// searchClients: auth через user-клиент (createClient), чтение по всей базе через
// admin-клиент (createAdminClient, обходит RLS). getCallbackBadgeCount: всё через
// user-клиент (RLS сам ограничивает менеджера его звонками).
const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  // Последний .or() фильтр (для проверки ilike-паттерна)
  lastOrFilter: null as string | null,
  // Ряды, которые вернёт clients-поиск
  searchRows: [] as Array<Record<string, unknown>>,
  searchError: null as { message: string } | null,
  // Значение настроек сегментации (crm_settings.segment_rules)
  segmentRulesValue: null as unknown,
  // Параметры и результат count-запроса для бейджа
  callbackFilters: {} as Record<string, unknown>,
  callbackCount: 0,
  callbackError: null as { message: string } | null,
}))

// admin-клиент: clients.select().or().limit() и crm_settings.select().eq().maybeSingle()
function makeAdminFrom(table: string) {
  if (table === 'clients') {
    const builder = {
      select: () => builder,
      or: (filter: string) => {
        state.lastOrFilter = filter
        return builder
      },
      limit: () => Promise.resolve({ data: state.searchRows, error: state.searchError }),
    }
    return builder
  }
  // crm_settings
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { value: state.segmentRulesValue }, error: null }),
      }),
    }),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeAdminFrom(table) }),
}))

// user-клиент: auth + call_logs count-chain
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => {
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          state.callbackFilters[col] = val
          return builder
        },
        then: (resolve: (v: { count: number; error: { message: string } | null }) => unknown) =>
          resolve({ count: state.callbackCount, error: state.callbackError }),
      }
      return builder
    },
  }),
}))

import { searchClients, getCallbackBadgeCount } from '@/app/(protected)/search-actions'

beforeEach(() => {
  state.user = { id: 'u1' }
  state.lastOrFilter = null
  state.searchRows = []
  state.searchError = null
  state.segmentRulesValue = null
  state.callbackFilters = {}
  state.callbackCount = 0
  state.callbackError = null
})

describe('searchClients', () => {
  it('возвращает ошибку для неавторизованного', async () => {
    state.user = null
    const res = await searchClients('Иван')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('Не авторизован')
  })

  it('пустой/только-структурный термин → пустой список без запроса', async () => {
    const res = await searchClients('   ')
    expect(res.success).toBe(true)
    if (res.success) expect(res.results).toEqual([])
    expect(state.lastOrFilter).toBeNull()
  })

  it('строит ilike-паттерн по name и phone', async () => {
    await searchClients('7777')
    expect(state.lastOrFilter).toBe('name.ilike.%7777%,phone.ilike.%7777%')
  })

  it('поиск по куску номера «+7777» сохраняет + (ilike-подстрока по E.164)', async () => {
    await searchClients('+7777')
    expect(state.lastOrFilter).toBe('name.ilike.%+7777%,phone.ilike.%+7777%')
  })

  it('маппит ряды и считает сегмент (override имеет приоритет)', async () => {
    state.searchRows = [
      { id: 'c1', name: 'Иван', phone: '+77770001122', total_orders: 5, last_order_date: '2026-06-01', segment_override: null },
      { id: 'c2', name: 'Пётр', phone: '+77770003344', total_orders: 1, last_order_date: null, segment_override: 'VIP' },
    ]
    const res = await searchClients('77')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.results).toHaveLength(2)
    expect(res.results[0]).toMatchObject({ id: 'c1', name: 'Иван', phone: '+77770001122', segment: 'Постоянный' })
    // override побеждает авто-расчёт
    expect(res.results[1].segment).toBe('VIP')
  })

  it('generic-ошибка при DB error (без SQL-деталей)', async () => {
    state.searchError = { message: 'relation "clients" does not exist' }
    const res = await searchClients('Иван')
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error).not.toContain('relation')
      expect(res.error).toBe('Ошибка поиска')
    }
  })
})

describe('getCallbackBadgeCount', () => {
  it('0 для неавторизованного', async () => {
    state.user = null
    expect(await getCallbackBadgeCount()).toBe(0)
  })

  it('фильтрует по status=callback, next_call_date=сегодня, manager_id', async () => {
    state.callbackCount = 3
    const count = await getCallbackBadgeCount()
    expect(count).toBe(3)
    expect(state.callbackFilters.status).toBe('callback')
    expect(state.callbackFilters.manager_id).toBe('u1')
    // next_call_date = сегодня в формате YYYY-MM-DD
    expect(state.callbackFilters.next_call_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('0 при DB error (бейдж не должен ломать сайдбар)', async () => {
    state.callbackError = { message: 'boom' }
    expect(await getCallbackBadgeCount()).toBe(0)
  })
})
