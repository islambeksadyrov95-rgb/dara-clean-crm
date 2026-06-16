import { AgbisSessionExpiredError } from './client'
import { getValidSession } from './session'

/**
 * Run an Agbis user-session command with the current session; on error:3 (session expired)
 * refresh once and retry exactly once. Reads are free (D-2026-06-15-arch-tariff-reads-free),
 * so a single retry is safe — there is no write/billing double-fire risk here.
 */
export async function withUserSession<T>(fn: (sessionId: string) => Promise<T>): Promise<T> {
  const sessionId = await getValidSession()
  try {
    return await fn(sessionId)
  } catch (err) {
    if (err instanceof AgbisSessionExpiredError) {
      const fresh = await getValidSession({ forceRefresh: true })
      return fn(fresh)
    }
    throw err
  }
}
