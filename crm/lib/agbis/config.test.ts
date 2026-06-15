import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAgbisConfig, resetAgbisConfigCache } from '@/lib/agbis/config'

const KEYS = ['AGBIS_API_BASE', 'AGBIS_API_USER', 'AGBIS_API_PWD'] as const
// sha1('Daryn101998') — known value from the live integration test
const SHA1_OF_PWD = '01c335a71b73b1a1ae20280b36015c0a836e7e6f'

describe('getAgbisConfig', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    resetAgbisConfigCache()
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    resetAgbisConfigCache()
  })

  it('throws when any credential env var is missing', () => {
    delete process.env.AGBIS_API_BASE
    process.env.AGBIS_API_USER = 'Дарын'
    process.env.AGBIS_API_PWD = 'x'
    expect(() => getAgbisConfig()).toThrow(/AGBIS_API_BASE/)
  })

  it('SHA-1 hashes the raw password and strips the trailing slash from base', () => {
    process.env.AGBIS_API_BASE = 'https://himinfo.org/cl/daraclean_838936e8/api/'
    process.env.AGBIS_API_USER = 'Дарын'
    process.env.AGBIS_API_PWD = 'Daryn101998'
    const config = getAgbisConfig()
    expect(config.base).toBe('https://himinfo.org/cl/daraclean_838936e8/api')
    expect(config.user).toBe('Дарын')
    expect(config.pwdSha1).toBe(SHA1_OF_PWD)
  })
})
