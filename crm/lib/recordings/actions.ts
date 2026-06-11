'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'

// Local MicroSIP recordings uploaded from the browser. We attach each MP3 to the
// nearest call_log (by phone parsed from filename, else by manager + time) and
// store a long-lived signed URL in call_logs.audio_url (reused by existing UI).

const RECORDINGS_BUCKET = 'call-recordings'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year
const MATCH_WINDOW_MS = 15 * 60 * 1000 // ±15 min around the recording's mtime
const PHONE_RE = /\d{10,12}/g

type AttachInput = { fileName: string; lastModifiedMs: number; storagePath: string }
type Admin = ReturnType<typeof createAdminClient>

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

  return { success: true as const, matched: true as const }
}
