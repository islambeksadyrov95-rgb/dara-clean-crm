import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { getAgbisConfig, resetAgbisConfigCache } from '@/lib/agbis/config'

const KEYS = ['AGBIS_API_BASE', 'AGBIS_API_USER', 'AGBIS_API_PWD'] as const

// Synthetic test credential — NOT the real password. The SHA-1 is derived here, so neither a
// plaintext password nor a precomputed hash of a real secret lives in source (secret hygiene).
const RAW_PWD = 'agbis-test-secret'
const SHA1_OF_PWD = createHash('sha1').update(RAW_PWD, 'utf8').digest('hex')
const TEST_BASE = 'https://agbis.example/cl/test/api'

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
    process.env.AGBIS_API_BASE = `${TEST_BASE}/`
    process.env.AGBIS_API_USER = 'Дарын'
    process.env.AGBIS_API_PWD = RAW_PWD
    const config = getAgbisConfig()
    expect(config.base).toBe(TEST_BASE)
    expect(config.user).toBe('Дарын')
    expect(config.pwdSha1).toBe(SHA1_OF_PWD)
  })

  it('uses a precomputed 40-hex SHA-1 as-is (lowercased)', () => {
    process.env.AGBIS_API_BASE = TEST_BASE
    process.env.AGBIS_API_USER = 'Дарын'
    process.env.AGBIS_API_PWD = SHA1_OF_PWD.toUpperCase()
    expect(getAgbisConfig().pwdSha1).toBe(SHA1_OF_PWD)
  })
})
