import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/agbis/client', () => ({ agbisCall: vi.fn() }))
vi.mock('@/lib/agbis/session', () => ({ getValidSession: vi.fn(async () => 'sid-1') }))

import {
  parseTripSlots,
  deriveEndOptions,
  buildTripOrderParams,
  parseTripOrderResponse,
  tripsHr,
  widestTripWindow,
  TRIP_TP,
} from './trips'
import { agbisCall } from '@/lib/agbis/client'

beforeEach(() => vi.clearAllMocks())

describe('parseTripSlots', () => {
  it('returns the hr array of HH:MM strings', () => {
    expect(parseTripSlots({ hr: ['00:00', '11:00', '12:00'] })).toEqual(['00:00', '11:00', '12:00'])
  })
  it('returns [] when hr missing or malformed', () => {
    expect(parseTripSlots({ error: 0 })).toEqual([])
    expect(parseTripSlots({ hr: 'x' })).toEqual([])
  })
})

describe('deriveEndOptions', () => {
  it('keeps only slots strictly after the chosen start', () => {
    expect(deriveEndOptions(['09:00', '10:00', '11:00', '12:00'], '10:00')).toEqual(['11:00', '12:00'])
  })
  it('returns [] when start is the last slot', () => {
    expect(deriveEndOptions(['09:00', '10:00'], '10:00')).toEqual([])
  })
})

describe('buildTripOrderParams', () => {
  it('maps a pickup trip to tp=1 with mp_status=0 and omits empty optionals', () => {
    const p = buildTripOrderParams({
      type: 'pickup', date: '17.06.2026', hr: '11:00', hrTo: '12:00',
      carId: '1023', address: 'ул. Абая 1', regionId: '1039', tel: '+77001234567',
    })
    expect(p.tp).toBe(TRIP_TP.pickup)
    expect(p.tp).toBe('1')
    expect(p.mp_status).toBe('0')
    expect(p.date).toBe('17.06.2026')
    expect(p.hr).toBe('11:00')
    expect(p.hr_to).toBe('12:00')
    expect(p.car_id).toBe('1023')
    expect(p.address).toBe('ул. Абая 1')
    expect(p.region_id).toBe('1039')
    expect(p.tel).toBe('+77001234567')
    expect('contr_id' in p).toBe(false)
    expect('comment' in p).toBe(false)
  })

  it('maps dropoff to tp=2 and passes contr_id/comment/user_id when present', () => {
    const p = buildTripOrderParams({
      type: 'dropoff', date: '17.06.2026', hr: '14:00', hrTo: '15:00',
      carId: '1023', address: 'A', regionId: '1', tel: '+7700',
      contrId: '555', comment: 'позвонить', userId: '1035', fio: 'Иван',
    })
    expect(p.tp).toBe('2')
    expect(p.contr_id).toBe('555')
    expect(p.comment).toBe('позвонить')
    expect(p.user_id).toBe('1035')
    expect(p.fio).toBe('Иван')
  })
})

describe('parseTripOrderResponse', () => {
  it('extracts TripID as string', () => {
    expect(parseTripOrderResponse({ error: 0, TripID: 9001 })).toEqual({ tripId: '9001' })
  })
  it('throws when TripID missing', () => {
    expect(() => parseTripOrderResponse({ error: 0 })).toThrow()
  })
})

describe('tripsHr', () => {
  it('calls Agbis and returns slots', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ hr: ['09:00', '10:00'] })
    expect(await tripsHr('17.06.2026', '1023')).toEqual(['09:00', '10:00'])
  })
})

describe('widestTripWindow', () => {
  it('returns first→last free slot', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ hr: ['09:00', '10:00', '14:00'] })
    expect(await widestTripWindow('17.06.2026', '1023')).toEqual({ hr: '09:00', hrTo: '14:00' })
  })
  it('uses the single slot for both ends', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ hr: ['09:00'] })
    expect(await widestTripWindow('17.06.2026', '1023')).toEqual({ hr: '09:00', hrTo: '09:00' })
  })
  it('returns null when there are no slots', async () => {
    vi.mocked(agbisCall).mockResolvedValue({ hr: [] })
    expect(await widestTripWindow('17.06.2026', '1023')).toBeNull()
  })
  it('returns null on Agbis error (non-fatal)', async () => {
    vi.mocked(agbisCall).mockRejectedValue(new Error('boom'))
    expect(await widestTripWindow('17.06.2026', '1023')).toBeNull()
  })
})
