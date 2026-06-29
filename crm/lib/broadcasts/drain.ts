import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppViaWazzup } from '@/lib/wazzup/send'

/**
 * Broadcast queue processor (Variant B). Claims up to `limit` pending recipients across all RUNNING
 * campaigns (claim_broadcast_recipients = FOR UPDATE SKIP LOCKED), sends each via the already-dynamic
 * sendWhatsAppViaWazzup (live active Wazzup channel → works with whatever number is QR-connected),
 * then settles it (settle_broadcast_recipient recomputes campaign counters + flips to 'done'). A small
 * jittered gap between sends is the anti-ban spacing; the per-run `limit` over a ~10-min cron sets the
 * average rate (~1/min). Failure is terminal (no retry — anti-ban). Service role. D-2026-06-28-crm-scope.
 */

const BATCH = 8 // upper bound on rows claimed per run; the wall-clock rate gate is the real limiter
const MIN_GAP_MS = 3000
const MAX_GAP_MS = 6000
// Anti-ban send rate lives in CODE, not in the cron cadence: at most ~1 WhatsApp message per minute
// with a tiny catch-up cap. The cron may fire every minute (fast Agbis sync) — sends stay compliant.
const MIN_SEND_INTERVAL_MS = 60_000
const MAX_PER_RUN = 2

export type BroadcastDrainResult = { processed: number; sent: number; failed: number }
type Claimed = { id: string; campaign_id: string; client_id: string | null; phone: string; message: string }
type AdminClient = ReturnType<typeof createAdminClient>

const defaultSleep = (): Promise<void> =>
  new Promise((r) => setTimeout(r, MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS))))

/** Campaign creator id → used as managerId for the Wazzup send log (campaigns require created_by). */
async function loadCreators(admin: AdminClient, campaignIds: string[]): Promise<Map<string, string>> {
  const { data } = await admin.from('broadcast_campaigns').select('id, created_by').in('id', campaignIds)
  return new Map((data ?? []).map((c) => [c.id, c.created_by]))
}

/** Timestamp (ms) of the most recent claim — the wall-clock rate anchor; null if nothing sent yet. */
async function lastClaimedAtMs(admin: AdminClient): Promise<number | null> {
  const { data } = await admin
    .from('broadcast_recipients')
    .select('claimed_at')
    .not('claimed_at', 'is', null)
    .order('claimed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.claimed_at ? new Date(data.claimed_at).getTime() : null
}

/** How many sends this run may make to hold ~1/min by wall-clock, regardless of cron frequency. */
function rateBudget(lastMs: number | null, nowMs: number): number {
  if (lastMs === null) return 1
  const elapsed = nowMs - lastMs
  if (elapsed < MIN_SEND_INTERVAL_MS) return 0
  return Math.min(MAX_PER_RUN, Math.floor(elapsed / MIN_SEND_INTERVAL_MS))
}

export async function drainBroadcasts(limit = BATCH, sleep = defaultSleep): Promise<BroadcastDrainResult> {
  const admin = createAdminClient()
  // Wall-clock rate gate: the cron may fire every minute, but WhatsApp sends stay ~1/min (anti-ban).
  const budget = rateBudget(await lastClaimedAtMs(admin), Date.now())
  if (budget === 0) return { processed: 0, sent: 0, failed: 0 }
  const { data, error } = await admin.rpc('claim_broadcast_recipients', {
    p_limit: Math.min(limit, budget),
    p_claimed_by: 'cron',
  })
  if (error) throw new Error('Не удалось захватить очередь рассылки')
  const rows = (data ?? []) as Claimed[]
  if (rows.length === 0) return { processed: 0, sent: 0, failed: 0 }

  const creatorByCampaign = await loadCreators(admin, [...new Set(rows.map((r) => r.campaign_id))])
  let sent = 0
  let failed = 0
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await sleep() // anti-ban spacing between messages
    const r = rows[i]
    const res = await sendWhatsAppViaWazzup({
      phone: r.phone,
      text: r.message,
      managerId: creatorByCampaign.get(r.campaign_id) ?? r.campaign_id,
    })
    await admin.rpc('settle_broadcast_recipient', {
      p_id: r.id,
      p_success: res.success,
      p_error: res.success ? undefined : res.error,
    })
    if (res.success) sent++
    else failed++
  }
  return { processed: rows.length, sent, failed }
}
