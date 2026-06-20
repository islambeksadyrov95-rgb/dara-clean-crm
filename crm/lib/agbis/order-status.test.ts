import { describe, it, expect } from 'vitest'
import {
  AGBIS_STATUS,
  STATUS_NAME_TO_ID,
  ALLOWED_TRANSITIONS,
  statusNameToId,
  isValidStatusId,
  isTransitionAllowed,
  allowedNextStatuses,
} from './order-status'

describe('AGBIS_STATUS / mapping', () => {
  it('5 статусов с верными id (05-commercial-session enum)', () => {
    expect(AGBIS_STATUS).toEqual({ 1: 'Новый', 3: 'В исполнении', 4: 'Исполненный', 5: 'Выданный', 7: 'Отменённый' })
  })
  it('name→id обратный маппинг', () => {
    expect(STATUS_NAME_TO_ID['Новый']).toBe(1)
    expect(STATUS_NAME_TO_ID['Выданный']).toBe(5)
    expect(STATUS_NAME_TO_ID['Отменённый']).toBe(7)
  })
  it('statusNameToId: неизвестное/null → null', () => {
    expect(statusNameToId('Новый')).toBe(1)
    expect(statusNameToId('Чего-то')).toBeNull()
    expect(statusNameToId(null)).toBeNull()
  })
  it('isValidStatusId', () => {
    expect(isValidStatusId(3)).toBe(true)
    expect(isValidStatusId(2)).toBe(false)
    expect(isValidStatusId(99)).toBe(false)
  })
})

describe('переходы (state machine)', () => {
  it('прямой поток + отмена', () => {
    expect(ALLOWED_TRANSITIONS[1]).toEqual([3, 7])
    expect(ALLOWED_TRANSITIONS[3]).toEqual([4, 7])
    expect(ALLOWED_TRANSITIONS[4]).toEqual([5, 7])
  })
  it('терминальные не имеют переходов', () => {
    expect(ALLOWED_TRANSITIONS[5]).toEqual([])
    expect(ALLOWED_TRANSITIONS[7]).toEqual([])
  })
  it('isTransitionAllowed: валидные', () => {
    expect(isTransitionAllowed('Новый', 3)).toBe(true)
    expect(isTransitionAllowed('Новый', 7)).toBe(true)
    expect(isTransitionAllowed('В исполнении', 4)).toBe(true)
  })
  it('isTransitionAllowed: запрещённые (назад, из терминального, неизвестные)', () => {
    expect(isTransitionAllowed('Выданный', 1)).toBe(false)
    expect(isTransitionAllowed('Новый', 5)).toBe(false) // нельзя перепрыгнуть
    expect(isTransitionAllowed('Отменённый', 3)).toBe(false)
    expect(isTransitionAllowed(null, 3)).toBe(false)
    expect(isTransitionAllowed('Новый', 2)).toBe(false) // несуществующий статус
  })
  it('allowedNextStatuses для UI', () => {
    expect(allowedNextStatuses('Новый')).toEqual([
      { id: 3, name: 'В исполнении' },
      { id: 7, name: 'Отменённый' },
    ])
    expect(allowedNextStatuses('Выданный')).toEqual([])
    expect(allowedNextStatuses(null)).toEqual([])
  })
})
