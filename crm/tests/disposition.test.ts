import { describe, it, expect, vi, beforeEach } from 'vitest'

// Мок Supabase клиента
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()

const mockSupabase = {
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

describe('recordDisposition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should return error when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const { recordDisposition } = await import('@/app/(protected)/queue/actions')
    const result = await recordDisposition({ clientId: 'client-1', status: 'reached' })

    expect(result).toEqual({ success: false, error: 'Не авторизован' })
  })

  it('should insert call_log with correct status and unlock client', async () => {
    const fakeUser = { id: 'user-123' }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })

    // insert chain для call_logs
    mockInsert.mockResolvedValue({ error: null })

    // select chain для clients
    const mockSelectChain = {} as any
    mockSelectChain.eq = vi.fn().mockReturnValue(mockSelectChain)
    mockSelectChain.single = vi.fn().mockResolvedValue({ data: { assigned_manager_id: null, locked_by: 'user-123' }, error: null })

    // update chain для unlock
    const mockEq2 = vi.fn()
    mockEq.mockReturnValue({ eq: mockEq2 })
    mockEq2.mockResolvedValue({ data: null, error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'call_logs') return { insert: mockInsert }
      if (table === 'clients') return { 
        select: vi.fn().mockReturnValue(mockSelectChain),
        update: mockUpdate 
      }
      return {}
    })
    mockUpdate.mockReturnValue({ eq: mockEq })

    const { recordDisposition } = await import('@/app/(protected)/queue/actions')
    const result = await recordDisposition({ clientId: 'client-1', status: 'reached' })

    expect(mockSupabase.from).toHaveBeenCalledWith('call_logs')
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-1',
      manager_id: 'user-123',
      status: 'reached',
    }))
    expect(mockSupabase.from).toHaveBeenCalledWith('clients')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      locked_by: null,
      locked_until: null,
      assigned_manager_id: 'user-123',
    }))
    expect(result).toEqual({ success: true })
  })

  it('should return error when insert fails', async () => {
    const fakeUser = { id: 'user-123' }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })

    mockInsert.mockResolvedValue({ error: { message: 'DB error' } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'call_logs') return { insert: mockInsert }
      return {}
    })

    const { recordDisposition } = await import('@/app/(protected)/queue/actions')
    const result = await recordDisposition({ clientId: 'client-1', status: 'not_reached' })

    expect(result).toEqual({ success: false, error: 'Ошибка записи: DB error' })
  })
})

describe('getDayStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should return zeros when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const { getDayStats } = await import('@/app/(protected)/queue/actions')
    const result = await getDayStats()

    expect(result).toEqual({
      calls: 0,
      reached: 0,
      orders: 0,
      revenue: 0,
      planRevenuePerDay: 85000,
      planOrdersPerDay: 5,
      dayTargetCalls: 40,
    })
  })

  it('should return counts from call_logs and orders', async () => {
    const fakeUser = { id: 'user-123' }
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })

    // Каждый from().select().eq().gte() ... должен вернуть count
    const makeChain = (count: number) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.gte = vi.fn(() => Promise.resolve({ count }))
      return chain
    }

    const callsChain = makeChain(5)
    const reachedChain = makeChain(3)
    const ordersChain = makeChain(2)

    // Четвертый чейн для выручки
    const revenueChain: Record<string, unknown> = {}
    revenueChain.select = vi.fn(() => revenueChain)
    revenueChain.eq = vi.fn(() => revenueChain)
    revenueChain.gte = vi.fn(() => Promise.resolve({ data: [{ amount: 15000 }, { amount: 25000 }], error: null }))

    // Чейн для sales_plans
    const salesPlansChain: Record<string, unknown> = {}
    salesPlansChain.select = vi.fn(() => salesPlansChain)
    salesPlansChain.eq = vi.fn(() => salesPlansChain)
    salesPlansChain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))

    // Чейн для crm_settings
    const crmSettingsChain: Record<string, unknown> = {}
    crmSettingsChain.select = vi.fn(() => crmSettingsChain)
    crmSettingsChain.eq = vi.fn(() => crmSettingsChain)
    crmSettingsChain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))

    let callLogsIdx = 0
    let ordersIdx = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'call_logs') {
        return callLogsIdx++ === 0 ? callsChain : reachedChain
      }
      if (table === 'orders') {
        return ordersIdx++ === 0 ? ordersChain : revenueChain
      }
      if (table === 'sales_plans') {
        return salesPlansChain
      }
      if (table === 'crm_settings') {
        return crmSettingsChain
      }
      return {}
    })

    const { getDayStats } = await import('@/app/(protected)/queue/actions')
    const result = await getDayStats()

    expect(result).toEqual({
      calls: 5,
      reached: 3,
      orders: 2,
      revenue: 40000,
      planRevenuePerDay: 85000,
      planOrdersPerDay: 5,
      dayTargetCalls: 40,
    })
  })
})
