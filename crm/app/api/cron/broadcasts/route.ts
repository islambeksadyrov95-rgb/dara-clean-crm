import { drainBroadcasts } from '@/lib/broadcasts/drain'

/**
 * Broadcast queue drain (Variant B). Sends the next batch of queued WhatsApp recipients via the
 * dynamic Wazzup channel, ~1/min over a ~10-min cron (anti-ban). Authorized by CRON_SECRET like the
 * other crons. Idempotent (claim_broadcast_recipients = FOR UPDATE SKIP LOCKED). Also piggybacked on
 * the read-sync cron so no extra external trigger is required. Created: 2026-06-29.
 *
 *   GET /api/cron/broadcasts            — send up to the default batch
 *   GET /api/cron/broadcasts?limit=20   — send up to `limit`
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_LIMIT = 50

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim()
  return secret !== '' && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ ok: false }, { status: 401 })

  const raw = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : undefined

  try {
    const result = await drainBroadcasts(limit)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('[broadcasts-cron]', (err as Error).message)
    return Response.json({ ok: false, error: 'drain_failed' }, { status: 500 })
  }
}
