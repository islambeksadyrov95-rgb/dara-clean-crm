import { createClient } from '@/lib/supabase/server'
import { getVpbxConfig, getRecordResponse } from '@/lib/vpbx/client'

// Authenticated proxy: streams a VPBX call recording.
// RLS on vpbx_calls enforces ownership (managers see only their own calls).
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const params = new URL(req.url).searchParams
  const uuid = params.get('uuid')
  if (!uuid) return new Response('uuid required', { status: 400 })

  // Ownership check: RLS returns the row only if the user may see this call.
  const { data: call } = await supabase
    .from('vpbx_calls')
    .select('id')
    .eq('vpbx_uuid', uuid)
    .maybeSingle()
  if (!call) return new Response('Запись не найдена', { status: 404 })

  const preview = params.get('preview') === '1'
  const config = await getVpbxConfig()
  const upstream = await getRecordResponse(config, uuid, preview)
  if (!upstream.ok || !upstream.body) {
    return new Response('Запись недоступна', { status: 404 })
  }

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  headers.set('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="call-${uuid}.mp3"`)
  headers.set('Cache-Control', 'private, max-age=3600')

  return new Response(upstream.body, { status: 200, headers })
}
