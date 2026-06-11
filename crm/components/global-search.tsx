'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { searchClients, type ClientSearchResult } from '@/app/(protected)/search-actions'
import { colorForSegment } from '@/lib/segments'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 300

type Status = 'idle' | 'loading' | 'error' | 'empty' | 'results'

// Триггер в шапке: выглядит как декоративный инпут, по клику/Ctrl+K открывает модал.
export function GlobalSearch() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 max-w-sm flex-1 items-center gap-2 rounded-lg border border-[#ebe9e4] px-3 text-[13px] text-muted-foreground transition-colors hover:bg-[#f7f6f3]"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span>Поиск клиента, заказа…</span>
        <span className="ml-auto hidden rounded border border-[#ebe9e4] px-1.5 py-0.5 text-[10px] text-[#a8a49a] sm:inline">
          Ctrl K
        </span>
      </button>
      {open && <SearchModal onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced поиск. Пустой термин → состояние idle (подсказка «начните печатать»).
  useEffect(() => {
    const trimmed = term.trim()
    if (!trimmed) {
      setStatus('idle')
      setResults([])
      setError('')
      return
    }

    setStatus('loading')
    let cancelled = false
    const timer = setTimeout(async () => {
      const res = await searchClients(trimmed)
      if (cancelled) return
      if (!res.success) {
        setError(res.error)
        setStatus('error')
        return
      }
      setResults(res.results)
      setStatus(res.results.length === 0 ? 'empty' : 'results')
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term])

  const goToClient = (id: string) => {
    router.push('/clients/' + id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[#ebe9e4] bg-white shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#ebe9e4] px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Имя или телефон клиента…"
            className="h-12 w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-[#ebe9e4] px-1.5 py-0.5 text-[10px] text-[#a8a49a] sm:inline">
            Esc
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          <SearchBody
            status={status}
            results={results}
            error={error}
            onPick={goToClient}
          />
        </div>
      </div>
    </div>
  )
}

function SearchBody({
  status,
  results,
  error,
  onPick,
}: {
  status: Status
  results: ClientSearchResult[]
  error: string
  onPick: (id: string) => void
}) {
  if (status === 'idle') {
    return <StateMessage text="Начните вводить имя или телефон" />
  }
  if (status === 'loading') {
    return <StateMessage text="Поиск…" />
  }
  if (status === 'error') {
    return <StateMessage text={error || 'Ошибка поиска'} tone="error" />
  }
  if (status === 'empty') {
    return <StateMessage text="Ничего не найдено" />
  }

  return (
    <ul className="py-1">
      {results.map((client) => (
        <li key={client.id}>
          <button
            type="button"
            onClick={() => onPick(client.id)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#f7f6f3]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-foreground">
                {client.name}
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {client.phone}
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                colorForSegment(client.segment),
              )}
            >
              {client.segment}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function StateMessage({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div
      className={cn(
        'px-4 py-8 text-center text-[13px]',
        tone === 'error' ? 'text-red-600' : 'text-muted-foreground',
      )}
    >
      {text}
    </div>
  )
}
