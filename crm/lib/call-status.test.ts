import { describe, it, expect } from 'vitest'
import { STATUS_LABELS, SUB_STATUS_LABELS, CALL_LABELS, callLabel } from './call-status'

describe('call-status labels', () => {
  it('exposes top-level status labels', () => {
    expect(STATUS_LABELS.reached).toBe('Дозвонился')
    expect(STATUS_LABELS.declined).toBe('Отказ')
  })

  it('exposes sub-status labels including added_broadcast', () => {
    expect(SUB_STATUS_LABELS.ordered).toBe('Заказ')
    expect(SUB_STATUS_LABELS.added_broadcast).toBe('В рассылку')
    expect(SUB_STATUS_LABELS.auto_3_strikes).toBe('3 попытки')
  })

  it('merges both maps into CALL_LABELS', () => {
    expect(CALL_LABELS.reached).toBe('Дозвонился')
    expect(CALL_LABELS.callback_later).toBe('Перезвон')
  })

  it('callLabel prefers sub_status, then status, then raw', () => {
    expect(callLabel('declined', 'decline_expensive')).toBe('Дорого')
    expect(callLabel('reached', null)).toBe('Дозвонился')
    expect(callLabel('mystery', 'unknown_sub')).toBe('mystery')
  })
})
