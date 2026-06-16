import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/agbis/client', () => ({ agbisCall: vi.fn() }))
vi.mock('@/lib/agbis/session', () => ({ getValidSession: vi.fn(async () => 'sid-1') }))

import {
  parseOrderTimes, getOrderTimes, DEFAULT_ORDER_TIMES,
  parseRegions, parseCars, getRegions, getCars,
} from './order-lists'
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

describe('parseRegions / parseCars', () => {
  it('parses regions and trims names', () => {
    expect(parseRegions({ regions: [{ id: '1039', name: ' Алмалинский' }] }))
      .toEqual([{ id: '1039', name: 'Алмалинский' }])
  })
  it('parses cars', () => {
    expect(parseCars({ cars: [{ id: '1023', name: 'Машина 2', address: '' }] }))
      .toEqual([{ id: '1023', name: 'Машина 2' }])
  })
  it('returns [] on missing keys', () => {
    expect(parseRegions({ error: 0 })).toEqual([])
    expect(parseCars({ error: 0 })).toEqual([])
  })
})

describe('getRegions / getCars', () => {
  it('returns parsed lists', async () => {
    vi.mocked(agbisCall).mockResolvedValueOnce({ regions: [{ id: '1', name: 'A' }] })
    expect(await getRegions()).toEqual([{ id: '1', name: 'A' }])
    vi.mocked(agbisCall).mockResolvedValueOnce({ cars: [{ id: '2', name: 'B' }] })
    expect(await getCars()).toEqual([{ id: '2', name: 'B' }])
  })
  it('falls back to [] on failure', async () => {
    vi.mocked(agbisCall).mockRejectedValue(new Error('boom'))
    expect(await getRegions()).toEqual([])
    expect(await getCars()).toEqual([])
  })
})
