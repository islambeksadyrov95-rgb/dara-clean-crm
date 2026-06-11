'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

type InboundRow = {
  vpbx_uuid: string | null
  direction: string
  client_id: string | null
  number_a: string | null
}

const TOAST_DURATION_MS = 20_000

/**
 * Global listener for incoming VPBX calls. Subscribes to vpbx_calls INSERTs and
 * shows a toast "Входящий звонок: <client>" with a shortcut to the client card.
 * RLS decides who receives each event (responsible manager, or all managers for
 * unassigned clients), so no client-side role filtering is needed.
 */
export function IncomingCallNotifier() {
  const router = useRouter()
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    const supabase = createClient()

    const handleInbound = async (row: InboundRow) => {
      if (row.direction !== 'inbound') return
      const key = row.vpbx_uuid ?? `${row.client_id ?? ''}-${row.number_a ?? ''}`
      if (seen.current.has(key)) return
      seen.current.add(key)

      let name = row.number_a ?? 'Неизвестный номер'
      const clientId = row.client_id
      if (clientId) {
        const { data } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle()
        if (data?.name) name = data.name
      }

      toast(`Входящий звонок: ${name}`, {
        duration: TOAST_DURATION_MS,
        action: clientId
          ? { label: 'Открыть карточку', onClick: () => router.push(`/clients/${clientId}`) }
          : undefined,
      })
    }

    const channel = supabase
      .channel('vpbx-incoming')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vpbx_calls' },
        (payload) => { void handleInbound(payload.new as InboundRow) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [router])

  return null
}
