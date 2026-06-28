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

const BATCH = 8 // recipients per run; ~0.8/min over a 10-min cron — anti-ban
const MIN_GAP_MS = 3000
const MAX_GAP_MS = 6000

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

export async function drainBroadcasts(limit = BATCH, sleep = defaultSleep): Promise<BroadcastDrainResult> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_broadcast_recipients', { p_limit: limit, p_claimed_by: 'cron' })
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
