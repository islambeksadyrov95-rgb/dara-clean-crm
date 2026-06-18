import { describe, it, expect } from 'vitest'
import { CLIENT_FILTER_FIELDS, CLIENT_FILTER_FIELD_KEYS, MANAGER_NONE } from './client-fields'

describe('client filter fields registry', () => {
  it('has unique keys and every key is in the whitelist set', () => {
    const keys = CLIENT_FILTER_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    keys.forEach((k) => expect(CLIENT_FILTER_FIELD_KEYS.has(k)).toBe(true))
  })

  it('multiselect fields with static semantics have options', () => {
    const callEver = CLIENT_FILTER_FIELDS.find((f) => f.key === 'call_ever')
    const nextAction = CLIENT_FILTER_FIELDS.find((f) => f.key === 'next_action')
    expect(callEver?.options?.length).toBeGreaterThan(0)
    expect(nextAction?.options?.length).toBeGreaterThan(0)
  })

  it('exposes the manager-none sentinel', () => {
    expect(MANAGER_NONE).toBe('__none__')
  })

  it('last_call_reason field carries canonical reason options', () => {
    const lastReason = CLIENT_FILTER_FIELDS.find((f) => f.key === 'last_call_reason')
    expect(lastReason?.options?.length).toBeGreaterThan(0)
    expect(lastReason?.options?.some((o) => o.value === 'no_money')).toBe(true)
  })
})
