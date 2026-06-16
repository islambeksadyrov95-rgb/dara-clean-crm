import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/agbis/client', () => ({ agbisCall: vi.fn() }))
vi.mock('@/lib/agbis/session', () => ({ getValidSession: vi.fn(async () => 'sid-1') }))

import { parseOrderTimes, getOrderTimes, DEFAULT_ORDER_TIMES } from './order-lists'
import { agbisCall } from '@/lib/agbis/client'

beforeEach(() => vi.clearAllMocks())

describe('parseOrderTimes', () => {
  it('maps ORDER_TIMES entries to {id,name}', () => {
    expect(parseOrderTimes({ ORDER_TIMES: [{ id: '0', name: 'Не срочный' }, { id: '2', name: 'Срочный' }] }))
      .toEqual([{ id: '0', name: 'Не срочный' }, { id: '2', name: 'Срочный' }])
  })
  it('drops rows missing id or name', () => {
    expect(parseOrderTimes({ ORDER_TIMES: [{ id: '0' }, { name: 'x' }, { id: '3', name: 'ok' }] }))
      .toEqual([{ id: '3', name: 'ok' }])
  })
  it('returns [] when ORDER_TIMES absent', () => {
    expect(parseOrderTimes({ error: 0 })).toEqual([])
  })
})

describe('getOrderTimes', () => {
  it('returns parsed live options when the API responds', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ ORDER_TIMES: [{ id: '0', name: 'Не срочный' }] })
    expect(await getOrderTimes()).toEqual([{ id: '0', name: 'Не срочный' }])
  })
  it('falls back to DEFAULT_ORDER_TIMES on API failure', async () => {
    vi.mocked(agbisCall).mockRejectedValue(new Error('boom'))
    expect(await getOrderTimes()).toEqual(DEFAULT_ORDER_TIMES)
  })
  it('falls back when the live list is empty', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ ORDER_TIMES: [] })
    expect(await getOrderTimes()).toEqual(DEFAULT_ORDER_TIMES)
  })
})
