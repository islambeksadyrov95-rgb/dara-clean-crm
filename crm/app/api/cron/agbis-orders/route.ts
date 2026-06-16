import { drainPendingOrders } from '@/lib/agbis/drain-orders'

/**
 * Order-outbox drain (CRM → Agbis write side). Separate endpoint from /api/cron/agbis (read-sync,
 * owned by the import stream). Retries queued order pushes — orders that went pending because the
 * client was not yet in Agbis are linked on demand and pushed. Authorized by CRON_SECRET, like the
 * other crons. Idempotent; safe to run on a schedule or manually.
 *
 *   GET /api/cron/agbis-orders            — drain up to 50 queued orders
 *   GET /api/cron/agbis-orders?limit=100  — drain up to `limit`
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim()
  return secret !== '' && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ ok: false }, { status: 401 })

  const raw = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT

  try {
    const result = await drainPendingOrders(limit)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('[agbis-orders-cron]', (err as Error).message)
    return Response.json({ ok: false, error: 'drain_failed' }, { status: 500 })
  }
}
