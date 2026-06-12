'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  listSourcesAdmin, createSource, toggleSource, listReviewQueue, assignSource, ignoreAnswer,
  type AcquisitionSource, type ReviewQueueItem,
} from './actions'

export const dynamic = 'force-dynamic'

// Админ-страница источников: строгий справочник + очередь разбора ответов,
// которые ИИ не смог уверенно сопоставить. Новые источники создаёт только человек.

export default function SourcesPage() {
  const [sources, setSources] = useState<AcquisitionSource[]>([])
  const [queue, setQueue] = useState<ReviewQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newSynonyms, setNewSynonyms] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    const [src, q] = await Promise.all([listSourcesAdmin(), listReviewQueue()])
    setSources(src)
    setQueue(q)
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    Promise.all([listSourcesAdmin(), listReviewQueue()]).then(([src, q]) => {
      if (!active) return
      setSources(src)
      setQueue(q)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  const handleCreate = async () => {
    setBusy(true)
    const res = await createSource(newName, newSynonyms)
    if (res.success) {
      toast.success('Источник создан')
      setNewName('')
      setNewSynonyms('')
      await reload()
    } else {
      toast.error(res.error)
    }
    setBusy(false)
  }

  const handleToggle = async (s: AcquisitionSource) => {
    const res = await toggleSource(s.id, !s.is_active)
    if (res.success) await reload()
    else toast.error(res.error)
  }

  const handleAssign = async (clientId: string, sourceId: string) => {
    if (!sourceId) return
    setBusy(true)
    const res = await assignSource(clientId, sourceId)
    if (res.success) {
      toast.success('Источник назначен')
      await reload()
    } else {
      toast.error(res.error)
    }
    setBusy(false)
  }

  const handleIgnore = async (clientId: string) => {
    setBusy(true)
    const res = await ignoreAnswer(clientId)
    if (res.success) await reload()
    else toast.error(res.error)
    setBusy(false)
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Загрузка...</p>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Источники клиентов</h1>
        <p className="text-sm text-muted-foreground">
          Откуда клиенты узнают о компании. Ответы менеджеров ИИ сопоставляет с этим справочником;
          непонятные попадают в разбор ниже.
        </p>
      </div>

      {/* Справочник */}
      <div className="bg-white border border-[#ebe9e4] rounded-xl p-5 shadow-xs space-y-3">
        <h2 className="text-sm font-semibold">Справочник ({sources.length})</h2>
        <div className="space-y-1.5">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-3 text-sm py-1 border-b border-[#f3f2ee] last:border-0">
              <span className={s.is_active ? 'font-medium' : 'font-medium text-muted-foreground line-through'}>
                {s.name}
              </span>
              {s.synonyms.length > 0 && (
                <span className="text-xs text-muted-foreground truncate">{s.synonyms.join(', ')}</span>
              )}
              <button
                type="button"
                onClick={() => handleToggle(s)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {s.is_active ? 'Отключить' : 'Включить'}
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <Input
            placeholder="Новый источник..."
            className="h-8 text-sm max-w-44"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            placeholder="Синонимы через запятую (для ИИ)"
            className="h-8 text-sm"
            value={newSynonyms}
            onChange={(e) => setNewSynonyms(e.target.value)}
          />
          <Button size="sm" className="h-8" disabled={busy || !newName.trim()} onClick={handleCreate}>
            Добавить
          </Button>
        </div>
      </div>

      {/* Очередь разбора */}
      <div className="bg-white border border-[#ebe9e4] rounded-xl p-5 shadow-xs space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          На разборе
          {queue.length > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-100">{queue.length}</Badge>}
        </h2>
        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">Все ответы разобраны</p>
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-2 border-b border-[#f3f2ee] last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{item.name} <span className="text-muted-foreground font-normal">{item.phone}</span></div>
                  <div className="text-xs text-muted-foreground italic truncate">«{item.rawAnswer}»</div>
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer focus:outline-none"
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => handleAssign(item.id, e.target.value)}
                >
                  <option value="" disabled>Назначить источник...</option>
                  {sources.filter((s) => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" disabled={busy} onClick={() => handleIgnore(item.id)}>
                  Игнорировать
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
