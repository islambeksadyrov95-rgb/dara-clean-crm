import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVpbxConfig, getRecordResponse } from '@/lib/vpbx/client'
import { transcribeAudio, scoreCall } from '@/lib/transcription/core'

/**
 * Downloads a VPBX call recording, transcribes it with Whisper, scores it
 * (when a client is matched) and stores the result on the vpbx_calls row.
 * Idempotent: a call already 'done' is skipped.
 */

const DOWNLOAD_ATTEMPTS = 3
const DOWNLOAD_RETRY_MS = 7000 // recording may not be ready immediately after CallFinish

type AdminClient = ReturnType<typeof createAdminClient>

export type TranscribeResult = { ok: boolean; reason?: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function downloadRecording(uuid: string): Promise<Blob | null> {
  const config = await getVpbxConfig()
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await getRecordResponse(config, uuid, false)
      if (response.ok) {
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 0) {
          const type = response.headers.get('content-type') ?? 'audio/mpeg'
          return new Blob([buffer], { type })
        }
      }
    } catch (err) {
      console.error('[vpbx-transcribe] download attempt failed', (err as Error).message)
    }
    if (attempt < DOWNLOAD_ATTEMPTS) await sleep(DOWNLOAD_RETRY_MS)
  }
  return null
}

async function markStatus(admin: AdminClient, uuid: string, status: 'failed'): Promise<void> {
  await admin
    .from('vpbx_calls')
    .update({ transcription_status: status, updated_at: new Date().toISOString() })
    .eq('vpbx_uuid', uuid)
}

type ClientContext = { segment: string; totalOrders: number; daysSinceLastOrder: number | null; clientName: string }

async function loadClientContext(admin: AdminClient, clientId: string): Promise<ClientContext | null> {
  // client_segments view is the single source of truth for the RFM segment label.
  const { data } = await admin
    .from('client_segments')
    .select('id, name, total_orders, last_order_date, rfm_segment')
    .eq('id', clientId)
    .maybeSingle()
  if (!data) return null

  const lastOrder = data.last_order_date as string | null
  const daysSinceLastOrder = lastOrder
    ? Math.floor((Date.now() - new Date(lastOrder).getTime()) / 86_400_000)
    : null

  return {
    clientName: (data.name as string) ?? 'Клиент',
    totalOrders: (data.total_orders as number) ?? 0,
    daysSinceLastOrder,
    segment: (data.rfm_segment as string) ?? 'Новый',
  }
}

export async function transcribeVpbxCall(uuid: string): Promise<TranscribeResult> {
  const admin = createAdminClient()

  const { data: call } = await admin
    .from('vpbx_calls')
    .select('id, vpbx_uuid, is_recorded, transcription_status, client_id')
    .eq('vpbx_uuid', uuid)
    .maybeSingle()

  if (!call) return { ok: false, reason: 'not_found' }
  if (call.transcription_status === 'done') return { ok: true }
  if (!call.is_recorded || !call.vpbx_uuid) return { ok: false, reason: 'no_recording' }

  const blob = await downloadRecording(call.vpbx_uuid as string)
  if (!blob) {
    await markStatus(admin, uuid, 'failed')
    return { ok: false, reason: 'download_failed' }
  }

  try {
    const { corrected } = await transcribeAudio(blob, `${call.vpbx_uuid}.mp3`)

    let summary: string | null = null
    let score: number | null = null
    if (corrected && call.client_id) {
      const ctx = await loadClientContext(admin, call.client_id as string)
      if (ctx) {
        const result = await scoreCall({ transcript: corrected, ...ctx })
        summary = result.summary
        score = result.score
      }
    }

    await admin
      .from('vpbx_calls')
      .update({
        transcript: corrected,
        summary,
        score,
        transcription_status: 'done',
        updated_at: new Date().toISOString(),
      })
      .eq('vpbx_uuid', uuid)

    return { ok: true }
  } catch (err) {
    console.error('[vpbx-transcribe] failed', (err as Error).message)
    await markStatus(admin, uuid, 'failed')
    return { ok: false, reason: 'transcribe_failed' }
  }
}
