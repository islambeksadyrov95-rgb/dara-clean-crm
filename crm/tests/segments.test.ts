import { describe, it, expect } from 'vitest'
import { SEGMENT_COLORS } from '../lib/segments'

// Инвариант: каждый RFM-сегмент имеет определённый класс бейджа.
// Пропущенный сегмент => бейдж без стиля в UI (реальный баг).
describe('SEGMENT_COLORS', () => {
  const RFM_SEGMENTS = ['Новый', 'Повторный', 'Постоянный', 'В риске', 'Потерянный']

  it('defines a non-empty class string for every RFM segment', () => {
    for (const segment of RFM_SEGMENTS) {
      expect(typeof SEGMENT_COLORS[segment]).toBe('string')
      expect(SEGMENT_COLORS[segment].length).toBeGreaterThan(0)
    }
  })

  it('has no extra/unknown segments', () => {
    expect(Object.keys(SEGMENT_COLORS).sort()).toEqual([...RFM_SEGMENTS].sort())
  })
})
