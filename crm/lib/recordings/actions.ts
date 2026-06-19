'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import { transcribeAudio, transcribePerChannel, scoreCall } from '@/lib/transcription/core'
import { storeAcquisitionFromCall } from '@/lib/acquisition/store'
import type { Json } from '@/types/database'

// Local MicroSIP recordings uploaded from the browser. We attach each MP3 to the
// nearest call_log (by phone parsed from filename, else by manager + time), store
// a long-lived signed URL in call_logs.audio_url, then transcribe + score it
// (both sides of the call) and write transcript/summary/call_score to the same row.

const RECORDINGS_BUCKET = 'call-recordings'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year
const MATCH_WINDOW_MS = 15 * 60 * 1000 // ±15 min around the recording's mtime
const PHONE_RE = /\d{10,12}/g

type AttachInput = { fileName: string; lastModifiedMs: number; storagePath: string }
type Admin = ReturnType<typeof createAdminClient>
type ClientContext = { segment: string; totalOrders: number; daysSinceLastOrder: number | null; clientName: string }

/** Finds a client whose phone appears in the recording filename. */
async function findClientIdByFilename(admin: Admin, fileName: string): Promise<string | null> {
  for (const digits of fileName.match(PHONE_RE) ?? []) {
    const phone = normalizePhone(digits)
    if (!phone) continue
    const { data } = await admin.from('clients').select('id').eq('phone', phone).maybeSingle()
    if (data?.id) return data.id as string
  }
  return null
}

/** Finds the call_log to attach: by client if known, else latest by this manager. */
async function findCallLogId(
  admin: Admin,
  opts: { clientId: string | null; managerId: string; from: string; to: string }
): Promise<string | null> {
  let query = admin
    .from('call_logs')
    .select('id')
    .gte('created_at', opts.from)
    .lte('created_at', opts.to)
    .order('created_at', { ascending: false })
    .limit(1)
  query = opts.clientId ? query.eq('client_id', opts.clientId) : query.eq('manager_id', opts.managerId)
  const { data } = await query.maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/** RFM context for scoring — mirrors the VPBX path (client_segments is the SSOT). */
async function loadClientContext(admin: Admin, clientId: string): Promise<ClientContext | null> {
  const { data } = await admin
    .from('client_segments')
    .select('id, name, total_orders, last_order_date, rfm_segment')
    .eq('id', clientId)
    .maybeSingle()
  if (!data) return null
  const lastOrder = data.last_order_date as string | null
  return {
    clientName: (data.name as string) ?? 'Клиент',
    totalOrders: (data.total_orders as number) ?? 0,
    daysSinceLastOrder: lastOrder ? Math.floor((Date.now() - new Date(lastOrder).getTime()) / 86_400_000) : null,
    segment: (data.rfm_segment as string) ?? 'Новый',
  }
}

/** Provably-Json value for the jsonb column (round-trip, без as-каста). */
function toJson(value: unknown): Json {
  const parsed: Json = JSON.parse(JSON.stringify(value))
  return parsed
}

/** RFM-скоринг транскрипта + извлечение источника. Общий для моно и парного пути. */
async function scoreTranscript(
  admin: Admin,
  transcript: string,
  clientId: string | null
): Promise<{ summary: string | null; score: number | null }> {
  if (!transcript || !clientId) return { summary: null, score: null }
  const ctx = await loadClientContext(admin, clientId)
  if (!ctx) return { summary: null, score: null }
  const result = await scoreCall({ transcript, ...ctx })
  // Источник из разговора: best-effort, ошибки не ломают транскрибацию.
  if (result.acquisitionAnswer) await storeAcquisitionFromCall(admin, clientId, result.acquisitionAnswer)
  return { summary: result.summary, score: result.score }
}

export async function attachLocalRecording(input: AttachInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false as const, error: 'Не авторизован' }

  const admin = createAdminClient()

  const { data: signed, error: signError } = await admin.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(input.storagePath, SIGNED_URL_TTL_SECONDS)
  if (signError || !signed) {
    return { success: false as const, error: signError?.message ?? 'Не удалось создать ссылку на запись' }
  }

  const clientId = await findClientIdByFilename(admin, input.fileName)
  const from = new Date(input.lastModifiedMs - MATCH_WINDOW_MS).toISOString()
  const to = new Date(input.lastModifiedMs + MATCH_WINDOW_MS).toISOString()

  const logId = await findCallLogId(admin, { clientId, managerId: user.id, from, to })
  if (!logId) return { success: true as const, matched: false as const }

  const { error: updateError } = await admin
    .from('call_logs')
    .update({ audio_url: signed.signedUrl })
    .eq('id', logId)
  if (updateError) return { success: false as const, error: updateError.message }

  return { success: true as const, matched: true as const, logId }
}

/**
 * Transcribes + scores an already-attached local recording and writes the result
 * to call_logs. Idempotent: a row that already has a transcript is skipped.
 */
export async function transcribeLocalRecording(callLogId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, reason: 'unauthorized' }

  const admin = createAdminClient()
  const { data: log } = await admin
    .from('call_logs')
    .select('id, audio_url, client_id, transcript')
    .eq('id', callLogId)
    .maybeSingle()
  if (!log?.audio_url) return { ok: false as const, reason: 'no_audio' }
  if (log.transcript) return { ok: true as const, reason: 'already_done' }

  try {
    const res = await fetch(log.audio_url as string, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`Загрузка записи ${res.status}`)
    const blob = await res.blob()
    const { corrected, segments } = await transcribeAudio(blob, 'call.mp3')

    const { summary, score } = await scoreTranscript(admin, corrected, log.client_id as string | null)

    const duration = segments.length > 0 ? Math.round(segments[segments.length - 1].end) : 0
    await admin
      .from('call_logs')
      .update({ transcript: corrected, summary, call_score: score, call_duration: duration })
      .eq('id', callLogId)
    return { ok: true as const }
  } catch (err) {
    console.error('[recordings] transcribe failed', err instanceof Error ? err.message : err)
    return { ok: false as const, reason: 'transcribe_failed' }
  }
}

type AttachPairInput = {
  managerFileName: string
  lastModifiedMs: number
  managerStoragePath: string
  clientStoragePath: string
}

/**
 * Attaches a dual-channel recording (recorder.py: __manager.wav + __client.wav) to
 * the nearest call_log. Stores the manager channel as the playable audio_url; the
 * Manager/Client dialogue is produced separately by transcribeLocalRecordingPair.
 */
export async function attachLocalRecordingPair(input: AttachPairInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false as const, error: 'Не авторизован' }

  const admin = createAdminClient()
  const { data: signed, error: signError } = await admin.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(input.managerStoragePath, SIGNED_URL_TTL_SECONDS)
  if (signError || !signed) {
    return { success: false as const, error: signError?.message ?? 'Не удалось создать ссылку на запись' }
  }

  const clientId = await findClientIdByFilename(admin, input.managerFileName)
  const from = new Date(input.lastModifiedMs - MATCH_WINDOW_MS).toISOString()
  const to = new Date(input.lastModifiedMs + MATCH_WINDOW_MS).toISOString()
  const logId = await findCallLogId(admin, { clientId, managerId: user.id, from, to })
  if (!logId) return { success: true as const, matched: false as const }

  const { error: updateError } = await admin.from('call_logs').update({ audio_url: signed.signedUrl }).eq('id', logId)
  if (updateError) return { success: false as const, error: updateError.message }
  return { success: true as const, matched: true as const, logId }
}

type TranscribePairInput = { callLogId: string; managerStoragePath: string; clientStoragePath: string }

/**
 * Transcribes a dual-channel recording per channel into a Manager/Client dialogue,
 * scores it (flat labelled transcript), and writes dialogue + transcript to the
 * call_log. Idempotent: a row that already has a transcript is skipped.
 */
export async function transcribeLocalRecordingPair(input: TranscribePairInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, reason: 'unauthorized' }

  const admin = createAdminClient()
  const { data: log } = await admin
    .from('call_logs')
    .select('id, client_id, transcript')
    .eq('id', input.callLogId)
    .maybeSingle()
  if (!log) return { ok: false as const, reason: 'no_log' }
  if (log.transcript) return { ok: true as const, reason: 'already_done' }

  try {
    const [mgr, cli] = await Promise.all([
      admin.storage.from(RECORDINGS_BUCKET).download(input.managerStoragePath),
      admin.storage.from(RECORDINGS_BUCKET).download(input.clientStoragePath),
    ])
    if (mgr.error || !mgr.data || cli.error || !cli.data) throw new Error('Не удалось скачать каналы записи')

    const { dialogue, transcript } = await transcribePerChannel(mgr.data, cli.data)
    const { summary, score } = await scoreTranscript(admin, transcript, log.client_id as string | null)
    const duration = dialogue.length > 0 ? Math.round(dialogue[dialogue.length - 1].end) : 0

    await admin
      .from('call_logs')
      .update({ dialogue: toJson(dialogue), transcript, summary, call_score: score, call_duration: duration })
      .eq('id', input.callLogId)
    return { ok: true as const }
  } catch (err) {
    console.error('[recordings] transcribe pair failed', err instanceof Error ? err.message : err)
    return { ok: false as const, reason: 'transcribe_failed' }
  }
}
