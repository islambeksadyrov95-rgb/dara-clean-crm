'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { FolderOpen, CheckCircle2, AlertTriangle, RefreshCw, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { idbGetHandle, idbSetHandle, loadUploaded, scanFolder, type DirHandle, type PermState } from '@/lib/recordings/sync-client'

const SCAN_INTERVAL_MS = 30_000

export function RecordingFolderSync() {
  const [supported, setSupported] = useState(true)
  const [connected, setConnected] = useState(false)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploadedCount, setUploadedCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<DirHandle | null>(null)

  const scanAndUpload = useCallback(async (handle: DirHandle) => {
    setSyncing(true)
    setError(null)
    try {
      const added = await scanFolder(handle)
      setUploadedCount(loadUploaded().size)
      setLastSync(new Date())
      if (added > 0) toast.success(`Записей загружено: ${added}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сканирования папки')
    } finally {
      setSyncing(false)
    }
  }, [])

  // Restore a previously connected folder on mount.
  useEffect(() => {
    let active = true
    const restore = async () => {
      if (typeof window === 'undefined' || !window.showDirectoryPicker) {
        setSupported(false)
        return
      }
      let handle: DirHandle | null = null
      try {
        handle = await idbGetHandle()
      } catch (err) {
        console.error('[recordings] restore failed', err)
        return
      }
      if (!handle || !active) return
      handleRef.current = handle
      setFolderName(handle.name)
      setUploadedCount(loadUploaded().size)
      const perm = await handle.queryPermission({ mode: 'read' }).catch((): PermState => 'prompt')
      if (!active) return
      if (perm === 'granted') {
        setConnected(true)
        scanAndUpload(handle)
      } else {
        setNeedsPermission(true)
      }
    }
    restore()
    return () => {
      active = false
    }
  }, [scanAndUpload])

  // Foreground scan while the settings page is open (the daemon covers other pages).
  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => {
      if (handleRef.current) scanAndUpload(handleRef.current)
    }, SCAN_INTERVAL_MS)
    return () => clearInterval(id)
  }, [connected, scanAndUpload])

  const connect = async () => {
    if (!window.showDirectoryPicker) return
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' })
      await idbSetHandle(handle)
      handleRef.current = handle
      setFolderName(handle.name)
      setConnected(true)
      setNeedsPermission(false)
      setError(null)
      await scanAndUpload(handle)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Не удалось открыть папку')
    }
  }

  const grant = async () => {
    const handle = handleRef.current
    if (!handle) return
    const perm = await handle.requestPermission({ mode: 'read' })
    if (perm === 'granted') {
      setConnected(true)
      setNeedsPermission(false)
      scanAndUpload(handle)
    }
  }

  return (
    <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-1.5">
          <Mic className="w-4 h-4 text-rose-500" /> Запись звонков (локальная папка)
        </CardTitle>
        <CardDescription className="text-xs">
          MicroSIP пишет MP3 на диск — CRM сама подхватывает их из выбранной папки, привязывает к звонкам, расшифровывает и оценивает.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-[11px] text-amber-600 leading-normal">
            Браузер не поддерживает доступ к папке. Откройте CRM в Chrome или Edge.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs">
              {connected ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Папка подключена{folderName ? `: ${folderName}` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium">
                  <AlertTriangle className="w-4 h-4" /> Папка не подключена
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {needsPermission ? (
                <Button type="button" size="sm" onClick={grant}>
                  <FolderOpen className="w-3.5 h-3.5 mr-1.5" /> Разрешить доступ к «{folderName}»
                </Button>
              ) : (
                <Button type="button" size="sm" variant={connected ? 'outline' : 'default'} onClick={connect}>
                  <FolderOpen className="w-3.5 h-3.5 mr-1.5" /> {connected ? 'Сменить папку' : 'Подключить папку'}
                </Button>
              )}
              {connected && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleRef.current && scanAndUpload(handleRef.current)}
                  disabled={syncing}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} /> Синхронизировать
                </Button>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground leading-relaxed space-y-0.5">
              <div>Загружено записей: {uploadedCount}</div>
              {lastSync && <div>Последняя синхронизация: {lastSync.toLocaleTimeString('ru-RU')}</div>}
              <div>Подхват записей работает на любой странице, пока открыта вкладка CRM.</div>
            </div>

            {error && <p className="text-[11px] text-red-600 leading-normal">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
