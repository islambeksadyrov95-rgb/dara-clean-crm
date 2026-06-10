import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'

/**
 * VPBX-Events webhook payloads (CallStart / CallState / CallFinish) and the
 * logic that turns one event into a `vpbx_calls` upsert.
 * Docs: spec.json schemas VpbxCallStartEvent / VpbxCallStateEvent / VpbxCallFinishEvent.
 */

const CALL_TYPES = ['INBOUND', 'OUTBOUND', 'INTERNAL'] as const
const FINISH_STATUSES = ['ANSWERED', 'NOT_ANSWERED', 'BUSY', 'CANCELLED'] as const
const CALL_STATES = ['UP', 'HELD'] as const

// Lenient schema: validates the fields we use, tolerates unknown extras.
export const VpbxEventSchema = z
  .object({
    type: z.string().min(1),
    eventID: z.string().min(1),
    companyId: z.union([z.string(), z.number()]).optional(),
    uuid: z.string().min(1),
    numberA: z.string().optional(),
    numberB: z.string().optional(),
    lineNumber: z.string().optional(),
    dialType: z.string().optional(),
    callType: z.enum(CALL_TYPES).optional(),
    abonentId: z.union([z.string(), z.number()]).optional(),
    externalCallId: z.string().nullable().optional(),
    c2c: z.boolean().optional(),
    isFirst: z.boolean().optional(),
    isLast: z.boolean().optional(),
    date: z.number().optional(),
    // CallFinishEvent
    callFinishedStatus: z.enum(FINISH_STATUSES).optional(),
    isRecorded: z.boolean().optional(),
    recordUrl: z.string().optional(),
    duration: z.number().optional(),
    // CallStateEvent
    callState: z.enum(CALL_STATES).optional(),
  })
  .loose()

export type VpbxEvent = z.infer<typeof VpbxEventSchema>

export type CallDirection = 'outbound' | 'inbound' | 'internal'

export type CallUpsert = {
  vpbx_uuid: string
  external_call_id?: string
  direction: CallDirection
  number_a?: string
  number_b?: string
  line_number?: string
  client_id?: string
  finish_status?: (typeof FINISH_STATUSES)[number]
  duration?: number
  is_recorded?: boolean
  record_url?: string
  transcription_status?: 'pending'
  started_at?: string
  answered_at?: string
  finished_at?: string
}

const DIRECTION_MAP: Record<(typeof CALL_TYPES)[number], CallDirection> = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
  INTERNAL: 'internal',
}

function unixToIso(seconds?: number): string | undefined {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : undefined
}

/** The client's phone for this call: caller for inbound, callee otherwise. */
export function pickClientNumber(event: VpbxEvent): string | null {
  if (event.callType === 'INBOUND') return event.numberA ?? null
  return event.numberB ?? null
}

/**
 * Pure mapping from an event to a partial vpbx_calls row.
 * Undefined fields are dropped before upsert, so existing values survive.
 */
export function buildCallUpsert(event: VpbxEvent): CallUpsert {
  const patch: CallUpsert = {
    vpbx_uuid: event.uuid,
    direction: event.callType ? DIRECTION_MAP[event.callType] : 'outbound',
  }
  if (event.externalCallId) patch.external_call_id = event.externalCallId
  if (event.numberA) patch.number_a = event.numberA
  if (event.numberB) patch.number_b = event.numberB
  if (event.lineNumber) patch.line_number = event.lineNumber

  if (event.type === 'CallStartEvent') {
    patch.started_at = unixToIso(event.date)
  } else if (event.type === 'CallStateEvent' && event.callState === 'UP') {
    patch.answered_at = unixToIso(event.date)
  } else if (event.type === 'CallFinishEvent') {
    patch.finished_at = unixToIso(event.date)
    if (event.callFinishedStatus) patch.finish_status = event.callFinishedStatus
    if (typeof event.duration === 'number') patch.duration = event.duration
    patch.is_recorded = event.isRecorded === true
    if (event.isRecorded) {
      if (event.recordUrl) patch.record_url = event.recordUrl
      patch.transcription_status = 'pending'
    }
  }

  return patch
}

export type ProcessResult = {
  ok: boolean
  duplicate?: boolean
  reason?: string
  event?: VpbxEvent
}

/**
 * Validates, deduplicates (by eventID), correlates the client, and upserts
 * the call. Returns the parsed event so the caller can trigger follow-up work
 * (e.g. transcription) for CallFinishEvent.
 */
export async function processVpbxEvent(raw: unknown): Promise<ProcessResult> {
  const parsed = VpbxEventSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_payload' }
  }
  const event = parsed.data
  const admin = createAdminClient()

  // Dedup: eventID is the PK. A duplicate insert means we already processed it.
  const { error: dedupError } = await admin.from('vpbx_events').insert({
    event_id: event.eventID,
    vpbx_uuid: event.uuid,
    type: event.type,
    payload: event,
  })
  if (dedupError) {
    if (dedupError.code === '23505') return { ok: true, duplicate: true, event }
    // Non-duplicate failure: log and keep going so the call still gets recorded.
    console.error('[vpbx-webhook] dedup insert failed', dedupError.message)
  }

  // Correlate the client by phone number.
  let clientId: string | undefined
  const phone = pickClientNumber(event)
  if (phone) {
    const normalized = normalizePhone(phone)
    const { data: client } = await admin
      .from('clients')
      .select('id')
      .eq('phone', normalized)
      .maybeSingle()
    if (client?.id) clientId = client.id as string
  }

  const patch: Record<string, unknown> = {
    ...buildCallUpsert(event),
    updated_at: new Date().toISOString(),
  }
  if (clientId) patch.client_id = clientId

  const { error: upsertError } = await admin
    .from('vpbx_calls')
    .upsert(patch, { onConflict: 'vpbx_uuid' })

  if (upsertError) {
    console.error('[vpbx-webhook] upsert failed', upsertError.message)
    return { ok: false, reason: 'upsert_failed', event }
  }

  return { ok: true, event }
}
