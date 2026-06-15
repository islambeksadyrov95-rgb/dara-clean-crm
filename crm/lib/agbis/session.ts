import { createAdminClient } from '@/lib/supabase/admin'
import { rawLogin, rawRefresh, type LoginResult } from './client'

/**
 * Agbis user-session manager. The session (10 min) lives in the agbis_session singleton
 * row (deny-by-default RLS → service role only). Refresh is single-flighted in-process
 * so parallel callers on one instance don't trigger duplicate Login → 429.
 * (Cross-instance pg_advisory lock — deferred to Phase 2 when the cron introduces real
 * concurrency; see PLAN.md v2 B7.)
 */

const SESSION_TTL_MS = 10 * 60 * 1000
const SAFETY_BUFFER_MS = 60 * 1000

let inflight: Promise<string> | null = null

export async function getValidSession(opts: { forceRefresh?: boolean } = {}): Promise<string> {
  if (!opts.forceRefresh) {
    const stored = await readStoredSession()
    if (stored) return stored
  }
  if (inflight) return inflight
  inflight = doRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

async function readStoredSession(): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('agbis_session')
    .select('session_id, expires_at')
    .eq('id', 1)
    .maybeSingle()

  if (
    data?.session_id &&
    data.expires_at &&
    new Date(data.expires_at).getTime() > Date.now() + SAFETY_BUFFER_MS
  ) {
    return data.session_id
  }
  return null
}

async function doRefresh(): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('agbis_session')
    .select('refresh_id')
    .eq('id', 1)
    .maybeSingle()

  const result = await loginOrRefresh(data?.refresh_id ?? null)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS - SAFETY_BUFFER_MS).toISOString()

  await admin.from('agbis_session').upsert({
    id: 1,
    session_id: result.sessionId,
    refresh_id: result.refreshId,
    user_id: result.userId,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  })

  return result.sessionId
}

async function loginOrRefresh(refreshId: string | null): Promise<LoginResult> {
  if (!refreshId) return rawLogin()
  try {
    return await rawRefresh(refreshId)
  } catch {
    // Stale/invalid refresh_id → fall back to a full login.
    return rawLogin()
  }
}
