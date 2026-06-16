import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ slotsSpy: vi.fn() }))
vi.mock('@/lib/agbis/trips', async (orig) => ({
  ...(await orig<typeof import('@/lib/agbis/trips')>()),
  tripsHr: h.slotsSpy,
}))

import { getTripSlots } from './trip-slots'

beforeEach(() => {
  h.slotsSpy.mockReset().mockResolvedValue(['09:00', '10:00', '11:00'])
})

describe('getTripSlots', () => {
  it('converts the ISO date to Agbis format and returns start slots', async () => {
    const res = await getTripSlots({ dateYMD: '2026-06-17', carId: '1023' })
    expect(res.success).toBe(true)
    expect(h.slotsSpy).toHaveBeenCalledWith('17.06.2026', '1023')
    if (res.success) expect(res.slots).toEqual(['09:00', '10:00', '11:00'])
  })

  it('rejects a malformed date (R2)', async () => {
    const res = await getTripSlots({ dateYMD: '17.06.2026', carId: '1023' })
    expect(res.success).toBe(false)
    expect(h.slotsSpy).not.toHaveBeenCalled()
  })

  it('returns a generic error when Agbis fails (R1)', async () => {
    h.slotsSpy.mockRejectedValueOnce(new Error('relation ...'))
    const res = await getTripSlots({ dateYMD: '2026-06-17', carId: '1023' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('Не удалось загрузить слоты выезда')
  })
})
