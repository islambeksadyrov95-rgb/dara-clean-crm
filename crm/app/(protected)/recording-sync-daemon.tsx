'use client'

import { useEffect, useRef } from 'react'
import { idbGetHandle, scanFolder } from '@/lib/recordings/sync-client'

const SCAN_INTERVAL_MS = 30_000

/**
 * Background daemon: scans the connected MicroSIP recordings folder on ANY page
 * (mounted in the protected layout), not just the telephony settings page.
 * Uploads new MP3s, attaches them to calls, transcribes + scores. Silent UI.
 */
export function RecordingSyncDaemon() {
  const busy = useRef(false)

  useEffect(() => {
    let active = true

    const tick = async () => {
      if (busy.current) return
      busy.current = true
      try {
        const handle = await idbGetHandle()
        if (!handle || !active) return
        const perm = await handle.queryPermission({ mode: 'read' })
        if (perm === 'granted') await scanFolder(handle)
      } catch (err) {
        console.error('[recordings-daemon]', err instanceof Error ? err.message : err)
      } finally {
        busy.current = false
      }
    }

    tick()
    const id = setInterval(tick, SCAN_INTERVAL_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  return null
}
