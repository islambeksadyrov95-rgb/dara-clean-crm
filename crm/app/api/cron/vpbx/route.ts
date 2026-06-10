import { getVpbxConfig, getWebhookUrl, subscribe } from '@/lib/vpbx/client'

// Backstop cron: renews the VPBX events subscription (TTL <= 24h).
// Authorized by CRON_SECRET (Vercel sends it as `Authorization: Bearer <secret>`).
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const secret = (process.env.CRON_SECRET ?? '').trim()
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 })
  }

  try {
    const config = await getVpbxConfig()
    if (!config.token || !config.profileId || !config.webhookSecret) {
      return Response.json({ ok: false, reason: 'not_configured' })
    }
    const sub = await subscribe(config, getWebhookUrl(config))
    return Response.json({ ok: true, subscriptionId: sub.subscriptionId, expiresAt: sub.expiresAt ?? null })
  } catch (err) {
    console.error('[vpbx-cron] renew failed', (err as Error).message)
    return Response.json({ ok: false, reason: 'renew_failed' })
  }
}
