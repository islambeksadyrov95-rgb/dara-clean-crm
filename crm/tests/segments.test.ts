import { describe, it, expect } from 'vitest'
import {
  SEGMENT_COLORS,
  computeSegment,
  parseSegmentConfig,
  DEFAULT_SEGMENT_RULES,
  colorForSegment,
  segmentNames,
} from '../lib/segments'

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

describe('computeSegment (matches SQL compute_segment)', () => {
  it('recency takes priority over frequency', () => {
    // 5 заказов, но 200 дней без заказа → Потерянный (как в БД)
    expect(computeSegment(5, 200)).toBe('Потерянный')
    expect(computeSegment(10, 120)).toBe('В риске')
  })

  it('classifies by order count when recent', () => {
    expect(computeSegment(4, 10)).toBe('Постоянный')
    expect(computeSegment(2, 10)).toBe('Повторный')
    expect(computeSegment(1, 10)).toBe('Новый')
  })

  it('treats a client with no orders (null days) as Новый', () => {
    expect(computeSegment(0, null)).toBe('Новый')
  })

  it('honors custom thresholds and names from config', () => {
    const config = {
      segments: [
        { name: 'Спящий', color: 'x', type: 'days_gt' as const, value: 30 },
        { name: 'VIP', color: 'y', type: 'orders_gte' as const, value: 3 },
        { name: 'Старт', color: 'z', type: 'default' as const, value: 0 },
      ],
    }
    expect(computeSegment(10, 40, config)).toBe('Спящий')
    expect(computeSegment(3, 5, config)).toBe('VIP')
    expect(computeSegment(1, 5, config)).toBe('Старт')
  })
})

describe('parseSegmentConfig', () => {
  it('falls back to defaults on garbage input', () => {
    expect(parseSegmentConfig(null)).toBe(DEFAULT_SEGMENT_RULES)
    expect(parseSegmentConfig('not json')).toBe(DEFAULT_SEGMENT_RULES)
    expect(parseSegmentConfig({ segments: [] })).toBe(DEFAULT_SEGMENT_RULES)
  })

  it('parses valid rules and skips malformed entries', () => {
    const cfg = parseSegmentConfig({
      segments: [
        { name: 'A', color: 'c', type: 'orders_gte', value: 5 },
        { name: '', type: 'default', value: 0 },
        { type: 'default', value: 0 },
      ],
    })
    expect(cfg.segments).toHaveLength(1)
    expect(cfg.segments[0].name).toBe('A')
  })
})

describe('colorForSegment / segmentNames', () => {
  it('returns the configured color, falling back to SEGMENT_COLORS', () => {
    expect(colorForSegment('Новый')).toContain('blue')
    expect(colorForSegment('Несуществующий')).toBe('')
  })

  it('lists names in rule order', () => {
    expect(segmentNames()).toEqual(['Потерянный', 'В риске', 'Постоянный', 'Повторный', 'Новый'])
  })
})
