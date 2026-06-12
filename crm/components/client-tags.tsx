'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  getClientTags, getAllTags, addTagToClient, removeTagFromClient, type ClientTag,
} from '@/app/(protected)/clients/tag-actions'

// Теги клиента: чипы + добавление существующего/создание нового.
// Самодостаточный: сам грузит свои данные (используется в панели звонка и карточке).

interface ClientTagsProps {
  clientId: string
  /** Компакт для панели звонка: без заголовка, мелкие чипы. */
  compact?: boolean
}

export function ClientTags({ clientId, compact = false }: ClientTagsProps) {
  const [tags, setTags] = useState<ClientTag[]>([])
  const [allTags, setAllTags] = useState<ClientTag[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([getClientTags(clientId), getAllTags()]).then(([clientTags, all]) => {
      if (!active) return
      setTags(clientTags)
      setAllTags(all)
    })
    return () => { active = false }
  }, [clientId])

  const refresh = async () => {
    const [clientTags, all] = await Promise.all([getClientTags(clientId), getAllTags()])
    setTags(clientTags)
    setAllTags(all)
  }

  const handleAdd = async (input: { tagId?: string; name?: string }) => {
    setBusy(true)
    const res = await addTagToClient(clientId, input)
    if (res.success) {
      setNewName('')
      setPickerOpen(false)
      await refresh()
    } else {
      toast.error(res.error)
    }
    setBusy(false)
  }

  const handleRemove = async (tagId: string) => {
    setBusy(true)
    const res = await removeTagFromClient(clientId, tagId)
    if (res.success) await refresh()
    else toast.error(res.error)
    setBusy(false)
  }

  const available = allTags.filter((t) => !tags.some((ct) => ct.id === t.id))

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-xs rounded-full border border-violet-200 bg-violet-50 text-violet-800"
          >
            {t.name}
            <button
              type="button"
              aria-label={`Убрать тег ${t.name}`}
              disabled={busy}
              onClick={() => handleRemove(t.id)}
              className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-violet-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="px-2 py-0.5 text-xs rounded-full border border-dashed border-[#d8d5cd] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          + тег
        </button>
      </div>

      {pickerOpen && (
        <div className="rounded-lg border border-[#ebe9e4] bg-[#fcfcfb] p-2 space-y-2 max-w-xs">
          {available.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleAdd({ tagId: t.id })}
                  className="px-2 py-0.5 text-xs rounded-full border border-[#ebe9e4] bg-white hover:bg-violet-50 hover:border-violet-200 transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input
              placeholder="Новый тег..."
              className="h-7 text-xs"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  e.preventDefault()
                  handleAdd({ name: newName })
                }
              }}
            />
            <Button size="sm" className="h-7 text-xs" disabled={busy || !newName.trim()} onClick={() => handleAdd({ name: newName })}>
              Создать
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
