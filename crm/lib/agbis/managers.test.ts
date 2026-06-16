import { describe, it, expect } from 'vitest'
import { getAgbisUserId } from './managers'

describe('getAgbisUserId', () => {
  it('maps known manager emails to their Agbis user_id', () => {
    expect(getAgbisUserId('elena@daraclean.kz')).toBe('1035')
    expect(getAgbisUserId('samal@daraclean.kz')).toBe('1023')
  })

  it('is case-insensitive and trims', () => {
    expect(getAgbisUserId('  Elena@DaraClean.kz ')).toBe('1035')
  })

  it('returns null for unmapped users (push falls back to API user)', () => {
    expect(getAgbisUserId('admin@dara.clean')).toBeNull()
    expect(getAgbisUserId(null)).toBeNull()
    expect(getAgbisUserId(undefined)).toBeNull()
  })
})
