import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const originalEnv = process.env

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv, WAZZUP_API_KEY: 'key-account-1', WAZZUP_API_KEY_2: 'key-account-2' }
})

describe('wazzup/keys', () => {
  it('getPrimaryWazzupKey возвращает ключ аккаунта 1 из env', async () => {
    const { getPrimaryWazzupKey } = await import('@/lib/wazzup/keys')
    expect(getPrimaryWazzupKey()).toBe('key-account-1')
  })

  it('getSecondaryWazzupKey возвращает ключ аккаунта 2 из env', async () => {
    const { getSecondaryWazzupKey } = await import('@/lib/wazzup/keys')
    expect(getSecondaryWazzupKey()).toBe('key-account-2')
  })

  it('getWazzupKeyForChannel: второй канal -> ключ аккаунта 2', async () => {
    const { getWazzupKeyForChannel } = await import('@/lib/wazzup/keys')
    const { WAZZUP_CHANNELS } = await import('@/lib/wazzup/config')
    expect(getWazzupKeyForChannel(WAZZUP_CHANNELS[1].id)).toBe('key-account-2')
  })

  it('getWazzupKeyForChannel: первый канал / undefined -> ключ аккаунта 1', async () => {
    const { getWazzupKeyForChannel } = await import('@/lib/wazzup/keys')
    const { WAZZUP_CHANNELS } = await import('@/lib/wazzup/config')
    expect(getWazzupKeyForChannel(WAZZUP_CHANNELS[0].id)).toBe('key-account-1')
    expect(getWazzupKeyForChannel(undefined)).toBe('key-account-1')
  })

  it('пустой env -> пустая строка (не падает)', async () => {
    process.env = { ...originalEnv, WAZZUP_API_KEY: '', WAZZUP_API_KEY_2: '' }
    vi.resetModules()
    const { getPrimaryWazzupKey } = await import('@/lib/wazzup/keys')
    expect(getPrimaryWazzupKey()).toBe('')
  })
})
