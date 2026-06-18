'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, X, Mic } from 'lucide-react'
import { useAuth } from './auth-context'
import { idbGetHandle, idbSetHandle, scanFolder } from '@/lib/recordings/sync-client'

// Глобальный баннер «подключить папку записей MicroSIP» для тех, кто звонит (hasSip).
// Менеджеру негде это сделать (весь /settings — adminOnly), а демон без выбранной папки
// молчит. Баннер виден на любой странице, пока папка не подключена; после — исчезает.
// showDirectoryPicker требует жест пользователя — поэтому именно кнопка, а не авто-вызов.

const DISMISS_KEY = 'dc-recordings-banner-dismissed'

export function RecordingFolderBanner() {
  const { hasSip } = useAuth()
  const [show, setShow] = useState(false)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!hasSip) return
    if (typeof window === 'undefined' || !window.showDirectoryPicker) return // только Chrome/Edge
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return
    let active = true
    const check = async () => {
      // Папка уже подключена и доступна → баннер не нужен.
      let connected = false
      try {
        const handle = await idbGetHandle()
        if (handle) {
          const perm = await handle.queryPermission({ mode: 'read' })
          connected = perm === 'granted'
        }
      } catch {
        connected = false
      }
      if (active && !connected) setShow(true)
    }
    check()
    return () => {
      active = false
    }
  }, [hasSip])

  const connect = async () => {
    if (!window.showDirectoryPicker) return
    setConnecting(true)
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' })
      await idbSetHandle(handle)
      const added = await scanFolder(handle)
      toast.success(added > 0 ? `Папка подключена. Загружено записей: ${added}` : 'Папка записей подключена')
      setShow(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return // пользователь закрыл диалог
      toast.error(err instanceof Error ? err.message : 'Не удалось подключить папку')
    } finally {
      setConnecting(false)
    }
  }

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* sessionStorage недоступен */
    }
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <Mic className="h-4 w-4 shrink-0 text-rose-500" />
      <span className="min-w-0 flex-1">
        Папка записей звонков не подключена — записи MicroSIP не загружаются и не расшифровываются.
      </span>
      <button
        type="button"
        onClick={connect}
        disabled={connecting}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
      >
        <FolderOpen className="h-3.5 w-3.5" /> {connecting ? 'Подключаю…' : 'Подключить папку'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Скрыть"
        className="shrink-0 rounded-full p-1 hover:bg-amber-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
