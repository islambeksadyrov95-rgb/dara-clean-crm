import { describe, it, expect } from 'vitest'
import { periodStartIso, aggregateAgbis, aggregateWazzup, aggregateTelephony } from '@/lib/integrations/stats'

describe('periodStartIso (Алматы UTC+5)', () => {
  // 2026-06-15T02:00:00Z = 07:00 по Алматы → начало суток Алматы = 2026-06-14T19:00:00Z
  const nowMs = Date.parse('2026-06-15T02:00:00.000Z')

  it('начало суток в TZ Алматы (не UTC)', () => {
    expect(periodStartIso('today', nowMs)).toBe('2026-06-14T19:00:00.000Z')
  })

  it('начало месяца в TZ Алматы', () => {
    expect(periodStartIso('month', nowMs)).toBe('2026-05-31T19:00:00.000Z')
  })
})

describe('aggregateAgbis', () => {
  it('считает платные/бесплатные/ошибки и разбивку по командам', () => {
    const rows = [
      { command: 'SaveOrderForAll', billed: true, error_code: null, executed_api_count: 10 },
      { command: 'SaveOrderForAll', billed: true, error_code: null, executed_api_count: 11 },
      { command: 'ContragForAll', billed: true, error_code: null, executed_api_count: null },
      { command: 'OrderByDateTimeForAll', billed: false, error_code: null, executed_api_count: null },
      { command: 'SaveOrderForAll', billed: false, error_code: 108, executed_api_count: null },
    ]
    const r = aggregateAgbis(rows)
    expect(r.paid).toBe(3)
    expect(r.free).toBe(2)
    expect(r.total).toBe(5)
    expect(r.errors).toBe(1)
    expect(r.executedApiCount).toBe(11)
    expect(r.byCommand).toContainEqual({ command: 'SaveOrderForAll', count: 2 })
    expect(r.byCommand).toContainEqual({ command: 'ContragForAll', count: 1 })
    // бесплатные команды не входят в разбивку платных
    expect(r.byCommand.find((c) => c.command === 'OrderByDateTimeForAll')).toBeUndefined()
  })
})

describe('aggregateWazzup', () => {
  it('считает всего/ошибки и разбивку по командам', () => {
    const rows = [
      { command: 'message.send', error_code: null },
      { command: 'message.send', error_code: '500' },
      { command: 'iframe.open', error_code: null },
    ]
    const r = aggregateWazzup(rows)
    expect(r.total).toBe(3)
    expect(r.errors).toBe(1)
    expect(r.byCommand).toContainEqual({ command: 'message.send', count: 2 })
    expect(r.byCommand).toContainEqual({ command: 'iframe.open', count: 1 })
  })
})

describe('aggregateTelephony', () => {
  it('считает всего/записанные и разбивку по направлению', () => {
    const calls = [
      { direction: 'inbound', is_recorded: true },
      { direction: 'inbound', is_recorded: false },
      { direction: 'outbound', is_recorded: true },
    ]
    const r = aggregateTelephony(calls, 42)
    expect(r.total).toBe(3)
    expect(r.recorded).toBe(2)
    expect(r.events).toBe(42)
    expect(r.byDirection).toContainEqual({ direction: 'inbound', count: 2 })
    expect(r.byDirection).toContainEqual({ direction: 'outbound', count: 1 })
  })
})
