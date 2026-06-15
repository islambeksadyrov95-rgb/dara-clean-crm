import { createHash } from 'node:crypto'

/**
 * Agbis API (MiniHim) connection config — read from env, never from crm_settings
 * (D-2026-06-15-arch-session-storage: crm_settings has SELECT USING(true)).
 * The raw password lives in AGBIS_API_PWD; we SHA-1 it here so the hash is never stored.
 * Login user is the Agbis.Химчистка program user (cyrillic, e.g. "Дарын"), AsUser="1".
 */
export type AgbisConfig = {
  base: string // .../api  (trailing slash stripped; client appends `/?`)
  user: string
  pwdSha1: string
}

let cached: AgbisConfig | null = null

export function getAgbisConfig(): AgbisConfig {
  if (cached) return cached

  const base = (process.env.AGBIS_API_BASE || '').trim().replace(/\/+$/, '')
  const user = (process.env.AGBIS_API_USER || '').trim()
  const pwd = (process.env.AGBIS_API_PWD || '').trim()

  if (!base || !user || !pwd) {
    throw new Error(
      'Интеграция Agbis не настроена: задайте AGBIS_API_BASE, AGBIS_API_USER, AGBIS_API_PWD',
    )
  }

  cached = {
    base,
    user,
    pwdSha1: createHash('sha1').update(pwd, 'utf8').digest('hex'),
  }
  return cached
}

/** Test-only: reset the memoized config so env changes take effect between tests. */
export function resetAgbisConfigCache(): void {
  cached = null
}
