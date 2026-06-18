import { describe, it, expect } from 'vitest'
import {
  STATUS_LABELS, SUB_STATUS_LABELS, CALL_LABELS, callLabel,
  CALL_REASONS, CALLBACK_REASON_CODES, deriveLastCallReason, reasonLabel,
} from './call-status'

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

describe('deriveLastCallReason', () => {
  it('отказ → канон. код из decline_* sub_status', () => {
    expect(deriveLastCallReason({ status: 'declined', subStatus: 'decline_expensive' })).toBe('expensive')
    expect(deriveLastCallReason({ status: 'declined', subStatus: 'decline_competitor' })).toBe('competitor')
    expect(deriveLastCallReason({ status: 'declined', subStatus: 'decline_other' })).toBe('other')
  })
  it('отказ с неизвестным/пустым sub_status → other', () => {
    expect(deriveLastCallReason({ status: 'declined', subStatus: 'decline_unknown' })).toBe('other')
    expect(deriveLastCallReason({ status: 'declined' })).toBe('other')
  })
  it('перезвон → причина-тег только для валидного канон. кода', () => {
    expect(deriveLastCallReason({ status: 'callback', reason: 'no_money' })).toBe('no_money')
    expect(deriveLastCallReason({ status: 'callback', reason: 'нет_денег' })).toBeNull() // сырой текст не код
    expect(deriveLastCallReason({ status: 'callback' })).toBeNull()
  })
  it('исходы без причины → null', () => {
    expect(deriveLastCallReason({ status: 'reached', subStatus: 'ordered' })).toBeNull()
    expect(deriveLastCallReason({ status: 'not_reached', subStatus: 'unavailable' })).toBeNull()
    expect(deriveLastCallReason({ status: 'not_relevant', subStatus: 'blocked' })).toBeNull()
  })
  it('все производные коды — валидные ключи CALL_REASONS (= значения CHECK миграции)', () => {
    const declineSubs = [
      'decline_expensive', 'decline_competitor', 'decline_not_needed',
      'decline_quality', 'decline_season', 'decline_other',
    ]
    for (const s of declineSubs) {
      const code = deriveLastCallReason({ status: 'declined', subStatus: s })
      expect(code && CALL_REASONS[code]).toBeTruthy()
    }
    for (const c of CALLBACK_REASON_CODES) {
      expect(deriveLastCallReason({ status: 'callback', reason: c })).toBe(c)
      expect(CALL_REASONS[c]).toBeTruthy()
    }
  })
})

describe('reasonLabel', () => {
  it('код → подпись, неизвестное → fallback (сырой текст), пусто → null', () => {
    expect(reasonLabel('no_money')).toBe('Нет денег')
    expect(reasonLabel('своя причина')).toBe('своя причина')
    expect(reasonLabel(null)).toBeNull()
    expect(reasonLabel(undefined)).toBeNull()
  })
})
