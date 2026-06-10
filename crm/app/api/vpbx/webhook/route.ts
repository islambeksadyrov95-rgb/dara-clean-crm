import { after } from 'next/server'
import { getVpbxConfig } from '@/lib/vpbx/client'
import { processVpbxEvent } from '@/lib/vpbx/events'
import { transcribeVpbxCall } from '@/lib/vpbx/transcribe'

// Public endpoint: VPBX posts call events here. Auth is the `s` query secret.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const config = await getVpbxConfig()
  const secret = new URL(req.url).searchParams.get('s')

  if (!config.webhookSecret || secret !== config.webhookSecret) {
    return Response.json({ ok: false }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false }, { status: 400 })
  }

  const result = await processVpbxEvent(body)

  // Trigger transcription after responding (recording may lag a few seconds).
  const event = result.event
  if (
    result.ok &&
    !result.duplicate &&
    event?.type === 'CallFinishEvent' &&
    event.isRecorded === true &&
    event.uuid
  ) {
    const uuid = event.uuid
    after(async () => {
      try {
        await transcribeVpbxCall(uuid)
      } catch (err) {
        console.error('[vpbx-webhook] transcription failed', (err as Error).message)
      }
    })
  }

  // Always ack with 200: a 4xx (except 429) deactivates the VPBX subscription.
  return Response.json({ ok: true })
}
