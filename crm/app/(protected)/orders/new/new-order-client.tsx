'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { searchClients, type ClientSearchResult } from '@/app/(protected)/search-actions'
import { createClient } from '@/app/(protected)/clients/actions'
import { OrderForm } from '@/app/(protected)/queue/order-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Full-page «Новый заказ» flow for /orders/new: pick an existing client (search by name/phone) ИЛИ
 * создать нового прямо здесь, затем показать общий OrderForm. Reuses searchClients + createClient (R11)
 * и общий OrderForm (как в очереди). Новый клиент CRM-локален: привязка к Агбису ленивая, при пуше заказа.
 */

type Picked = { id: string; name: string }
type Mode = 'search' | 'create'

export function NewOrderClient() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)

  const back = () => router.push('/orders')

  const runSearch = async (term?: string) => {
    const q = (term ?? query).trim()
    if (!q) return
    setSearching(true); setError(null)
    try {
      const res = await searchClients(q)
      if (res.success) { setResults(res.results); setSearched(true) }
      else setError(res.error)
    } catch {
      setError('Не удалось выполнить поиск')
    } finally {
      setSearching(false)
    }
  }

  // Дубликат телефона при создании → вернуть в поиск с подставленным номером, чтобы выбрать существующего.
  const handleDuplicate = (phone: string) => {
    toast.info('Клиент с таким номером уже есть — выберите его из поиска')
    setMode('search'); setQuery(phone); void runSearch(phone)
  }

  if (picked) {
    return <OrderForm clientId={picked.id} clientName={picked.name} onDone={back} onCancel={back} />
  }

  if (mode === 'create') {
    const looksLikePhone = /\d{3,}/.test(query)
    return (
      <CreateClientForm
        initialName={looksLikePhone ? '' : query}
        initialPhone={looksLikePhone ? query : ''}
        onCreated={setPicked}
        onDuplicate={handleDuplicate}
        onBack={() => setMode('search')}
      />
    )
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Выберите клиента</div>
        <Button size="sm" variant="ghost" onClick={back}>Назад к заказам</Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Имя или телефон..." value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }} className="h-9" />
        <Button size="sm" onClick={() => void runSearch()} disabled={searching || !query.trim()}>
          {searching ? 'Поиск...' : 'Найти'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode('create')}>+ Новый клиент</Button>
      </div>
      {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      {searched && results.length === 0 && !error && (
        <div className="flex items-center justify-between text-sm py-2">
          <span className="text-muted-foreground">Ничего не найдено</span>
          <Button size="sm" variant="outline" onClick={() => setMode('create')}>Создать нового клиента</Button>
        </div>
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
    </div>
  )
}

/** Инлайн-форма создания клиента. Успех → сразу в OrderForm через onCreated. */
function CreateClientForm({ initialName, initialPhone, onCreated, onDuplicate, onBack }: {
  initialName: string
  initialPhone: string
  onCreated: (picked: Picked) => void
  onDuplicate: (phone: string) => void
  onBack: () => void
}) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || !phone.trim()) { setError('Укажите имя и телефон'); return }
    setBusy(true); setError(null)
    try {
      const res = await createClient(name.trim(), phone.trim(), address.trim() || undefined)
      if (res.success) {
        onCreated({ id: res.clientId, name: name.trim() })
        return
      }
      if (res.error.includes('уже существует')) { onDuplicate(phone.trim()); return }
      setError(res.error)
    } catch {
      setError('Не удалось создать клиента')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Новый клиент</div>
        <Button size="sm" variant="ghost" onClick={onBack}>Назад к поиску</Button>
      </div>
      <div className="space-y-2">
        <Input placeholder="Имя клиента" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        <Input placeholder="Телефон (+7...)" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" />
        <Input placeholder="Адрес (необязательно)" value={address} onChange={(e) => setAddress(e.target.value)} className="h-9" />
      </div>
      {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={busy || !name.trim() || !phone.trim()}>
          {busy ? 'Создание...' : 'Создать и продолжить'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>Отмена</Button>
      </div>
    </div>
  )
}
