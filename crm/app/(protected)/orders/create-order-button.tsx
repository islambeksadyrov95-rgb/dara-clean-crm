'use client'

import { useState } from 'react'
import { searchClients, type ClientSearchResult } from '@/app/(protected)/search-actions'
import { OrderForm } from '@/app/(protected)/queue/order-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * "Создать заказ" entry point for /orders: pick a client (search by name/phone), then show the
 * order form. Reuses searchClients (R11) and the shared OrderForm (same component as the queue).
 * On success the order is pushed to Agbis (linking the client on demand) — see createOrder.
 */

type Picked = { id: string; name: string }

export function CreateOrderButton() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)

  const reset = () => {
    setOpen(false); setQuery(''); setResults([]); setSearched(false); setError(null); setPicked(null)
  }

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true); setError(null)
    try {
      const res = await searchClients(query.trim())
      if (res.success) { setResults(res.results); setSearched(true) }
      else setError(res.error)
    } catch {
      setError('Не удалось выполнить поиск')
    } finally {
      setSearching(false)
    }
  }

  if (!open) {
    return <Button size="sm" onClick={() => setOpen(true)}>Создать заказ</Button>
  }

  return (
    <div className="rounded-lg border p-4 bg-background space-y-3 w-full max-w-3xl">
      {picked ? (
        <OrderForm clientId={picked.id} clientName={picked.name} onDone={reset} onCancel={reset} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Выберите клиента</div>
            <Button size="sm" variant="ghost" onClick={reset}>Закрыть</Button>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Имя или телефон..." value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }} className="h-9" />
            <Button size="sm" onClick={() => void runSearch()} disabled={searching || !query.trim()}>
              {searching ? 'Поиск...' : 'Найти'}
            </Button>
          </div>
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
          {searched && results.length === 0 && !error && (
            <div className="text-muted-foreground text-sm py-2">Ничего не найдено</div>
          )}
          <div className="divide-y">
            {results.map((c) => (
              <button key={c.id} type="button" onClick={() => setPicked({ id: c.id, name: c.name })}
                className="w-full text-left py-2 px-1 hover:bg-muted/40 flex justify-between text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">{c.phone}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
