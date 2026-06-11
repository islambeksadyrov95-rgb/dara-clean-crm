import { describe, it, expect, vi } from 'vitest'

// Лёгкие моки серверных зависимостей, чтобы модуль импортировался в node-окружении.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import * as team from '@/app/(protected)/team/actions'
import { WAZZUP_CHANNELS } from '@/lib/wazzup/config'

describe('team/actions — поверхность модуля', () => {
  it('экспортирует серверные действия', () => {
    expect(typeof team.getTeamPerformance).toBe('function')
    expect(typeof team.createEmployee).toBe('function')
  })

  it('каналы Wazzup заданы (используются в синке вместо хардкода)', () => {
    expect(WAZZUP_CHANNELS).toHaveLength(2)
    expect(WAZZUP_CHANNELS[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(WAZZUP_CHANNELS[1].id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
