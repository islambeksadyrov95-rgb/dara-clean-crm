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

    const scan = async () => {
      const handle = await idbGetHandle()
      if (!handle || !active) return
      const perm = await handle.queryPermission({ mode: 'read' })
      if (perm === 'granted') await scanFolder(handle)
    }

    const tick = async () => {
      // Офлайн — не пытаемся грузить; busy — предыдущий скан ещё идёт.
      if (busy.current || !navigator.onLine) return
      busy.current = true
      try {
        // Web Locks: при нескольких вкладках CRM сканирует только одна —
        // иначе параллельные вкладки дублируют upload/transcribe.
        if (navigator.locks) {
          await navigator.locks.request('dara-recordings-scan', { ifAvailable: true }, async (lock) => {
            if (lock) await scan()
          })
        } else {
          await scan()
        }
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
