import { describe, it, expect } from 'vitest'
import {
  DispositionSchema, computeNextAction, isArchiving, reachedAttemptLimit, MAX_ATTEMPTS,
} from './disposition-build'

const UUID = '11111111-1111-4111-8111-111111111111'
// Фиксированный «сейчас» (Алматы-смещение учитывается внутри). 2026-06-18T00:00:00Z.
const NOW = Date.UTC(2026, 5, 18, 0, 0, 0)

describe('DispositionSchema', () => {
  it('отказ без причины (subStatus) — невалиден (D-2026-06-18)', () => {
    const r = DispositionSchema.safeParse({ clientId: UUID, status: 'declined' })
    expect(r.success).toBe(false)
  })
  it('отказ с причиной — валиден', () => {
    const r = DispositionSchema.safeParse({ clientId: UUID, status: 'declined', subStatus: 'decline_expensive' })
    expect(r.success).toBe(true)
  })
  it('перезвон без причины — валиден (причина опциональна)', () => {
    const r = DispositionSchema.safeParse({ clientId: UUID, status: 'callback', subStatus: 'callback_later' })
    expect(r.success).toBe(true)
  })
  it('невалидный uuid / статус отклоняется', () => {
    expect(DispositionSchema.safeParse({ clientId: 'x', status: 'reached' }).success).toBe(false)
    expect(DispositionSchema.safeParse({ clientId: UUID, status: 'bogus' }).success).toBe(false)
  })
})

describe('computeNextAction', () => {
  it('перезвон без даты → +2 дня (дефолт), type=callback', () => {
    const r = computeNextAction({ status: 'callback', subStatus: 'callback_later', attemptNumber: 0, nowMs: NOW })
    expect(r.nextActionType).toBe('callback')
    expect(r.nextActionAt).toBe(new Date(NOW + 2 * 24 * 3600_000).toISOString())
  })
  it('перезвон с конкретной датой+временем (Алматы) → UTC −5ч', () => {
    const r = computeNextAction({ status: 'callback', attemptNumber: 0, nowMs: NOW, nextCallDate: '2026-06-20', nextCallTime: '14:00' })
    // 2026-06-20 14:00 Алматы = 09:00 UTC
    expect(r.nextActionAt).toBe('2026-06-20T09:00:00.000Z')
  })
  it('не дозвонился (unavailable) каденс: 1→+4ч, 2→+1д, 3→+3д', () => {
    expect(computeNextAction({ status: 'not_reached', subStatus: 'unavailable', attemptNumber: 1, nowMs: NOW }).nextActionAt)
      .toBe(new Date(NOW + 4 * 3600_000).toISOString())
    expect(computeNextAction({ status: 'not_reached', subStatus: 'unavailable', attemptNumber: 2, nowMs: NOW }).nextActionAt)
      .toBe(new Date(NOW + 24 * 3600_000).toISOString())
    expect(computeNextAction({ status: 'not_reached', subStatus: 'unavailable', attemptNumber: 3, nowMs: NOW }).nextActionType)
      .toBe('retry')
  })
  it('заказ / отказ / заблокировал → задача не планируется (null)', () => {
    expect(computeNextAction({ status: 'reached', subStatus: 'ordered', attemptNumber: 0, nowMs: NOW }).nextActionAt).toBeNull()
    expect(computeNextAction({ status: 'declined', subStatus: 'decline_other', attemptNumber: 0, nowMs: NOW }).nextActionAt).toBeNull()
    expect(computeNextAction({ status: 'not_relevant', subStatus: 'blocked', attemptNumber: 0, nowMs: NOW }).nextActionAt).toBeNull()
  })
})

describe('isArchiving / reachedAttemptLimit', () => {
  it('архивируют: declined, not_relevant (неверный/заблокировал/3-страйка)', () => {
    expect(isArchiving('declined', 'decline_expensive')).toBe(true)
    expect(isArchiving('not_relevant', 'wrong_number')).toBe(true)
    expect(isArchiving('not_relevant', 'blocked')).toBe(true)
  })
  it('НЕ архивируют: reached, callback, not_reached/unavailable', () => {
    expect(isArchiving('reached', 'ordered')).toBe(false)
    expect(isArchiving('callback', 'callback_later')).toBe(false)
    expect(isArchiving('not_reached', 'unavailable')).toBe(false)
  })
  it('порог авто-архива = MAX_ATTEMPTS (4)', () => {
    expect(MAX_ATTEMPTS).toBe(4)
    expect(reachedAttemptLimit(3)).toBe(false)
    expect(reachedAttemptLimit(4)).toBe(true)
  })
})
