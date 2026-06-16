'use client'

import { useEffect, useMemo, useState } from 'react'
import { createOrder } from '@/app/(protected)/queue/order/actions'
import { getOrderFormData, type CatalogService, type OrderFormData } from '@/app/(protected)/queue/order/catalog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { almatyTodayYMD } from '@/lib/agbis/order-dates'

type Props = {
  clientId: string
  clientName: string
  totalOrders?: number
  onDone: () => void
  onCancel: () => void
}

type Result = { agbisStatus: 'synced' | 'pending'; dorId: string | null; amount: number }

const fmtTenge = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

function groupServices(services: CatalogService[]): [string, CatalogService[]][] {
  const map = new Map<string, CatalogService[]>()
  for (const s of services) {
    const arr = map.get(s.group)
    if (arr) arr.push(s)
    else map.set(s.group, [s])
  }
  return Array.from(map.entries())
}

export function OrderForm({ clientId, clientName, onDone, onCancel }: Props) {
  const [form, setForm] = useState<OrderFormData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [scladId, setScladId] = useState('')
  const [comment, setComment] = useState('')
  const [intakeDate, setIntakeDate] = useState(() => almatyTodayYMD())
  const [deliveryAt, setDeliveryAt] = useState('')
  const [fastExecId, setFastExecId] = useState('0')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await getOrderFormData()
        if (!active) return
        if (!res.success) { setLoadError(res.error); return }
        setForm(res.data)
        setScladId(res.data.warehouses[0]?.id ?? '')
        setFastExecId(res.data.orderTimes[0]?.id ?? '0')
      } catch {
        if (active) setLoadError('Не удалось загрузить каталог услуг')
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const grouped = useMemo(() => groupServices(form?.services ?? []), [form])
  const priceOf = useMemo(() => {
    const m = new Map(form?.services.map((s) => [s.tovarId, s]) ?? [])
    return (id: string) => m.get(id)
  }, [form])

  const selected = Object.entries(qty).filter(([, q]) => q > 0)
  const total = selected.reduce((sum, [id, q]) => sum + (priceOf(id)?.price ?? 0) * q, 0)
  const canSubmit = !submitting && selected.length > 0 && scladId.length > 0

  const toggle = (id: string) => setQty((p) => ({ ...p, [id]: p[id] > 0 ? 0 : 1 }))
  const setItemQty = (id: string, v: number) => setQty((p) => ({ ...p, [id]: Math.max(0, Math.floor(v) || 0) }))

  const handleSubmit = async () => {
    setError(null)
    const items = selected.flatMap(([id, q]) => {
      const svc = priceOf(id)
      return svc ? [{ tovarId: id, name: svc.name, qty: q, unitPrice: svc.price }] : []
    })
    if (!items.length) { setError('Выберите услугу'); return }
    setSubmitting(true)
    const res = await createOrder({
      clientId, items, scladId,
      comment: comment.trim() || undefined,
      intakeDate,
      deliveryAt: deliveryAt || undefined,
      fastExecId,
    })
    setSubmitting(false)
    if (!res.success) { setError(res.error); return }
    setResult({ agbisStatus: res.order.agbisStatus, dorId: res.order.dorId, amount: res.order.amount })
  }

  if (loadError) return <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{loadError}</div>
  if (!form) return <div className="text-muted-foreground py-6 text-center text-sm">Загрузка каталога...</div>
  if (!form.services.length) return <div className="text-muted-foreground py-6 text-center text-sm">Каталог услуг пуст</div>

  if (result) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-lg bg-green-50 border border-green-200">
          <div className="font-semibold text-green-800 mb-1">Заказ создан · {fmtTenge(result.amount)}</div>
          <div className="text-sm text-muted-foreground">
            {result.agbisStatus === 'synced'
              ? `Отправлен в Агбис (№ ${result.dorId})`
              : 'Отправка в Агбис поставлена в очередь'}
          </div>
        </div>
        <Button size="sm" onClick={onDone} className="w-full">Следующий клиент</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">Новый заказ — {clientName}</div>

      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {grouped.map(([group, items]) => (
          <div key={group}>
            <div className="text-xs text-muted-foreground mb-1">{group}</div>
            {items.map((s) => (
              <div key={s.tovarId} className="flex items-center gap-2 text-sm py-0.5">
                <Checkbox checked={(qty[s.tovarId] ?? 0) > 0} onCheckedChange={() => toggle(s.tovarId)} />
                <span className="flex-1">{s.name}</span>
                <span className="text-muted-foreground text-xs">{fmtTenge(s.price)}</span>
                {(qty[s.tovarId] ?? 0) > 0 && (
                  <Input
                    type="number" min={1} value={qty[s.tovarId]}
                    onChange={(e) => setItemQty(s.tovarId, Number(e.target.value))}
                    className="w-16 h-7"
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="text-[11px] text-muted-foreground">Ковры — скоро (нужен ввод площади и типа).</div>

      <div>
        <Label htmlFor="order-sclad" className="mb-1 block text-xs text-muted-foreground">Склад (приём/выдача)</Label>
        <select
          id="order-sclad" value={scladId} onChange={(e) => setScladId(e.target.value)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {form.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="order-intake" className="mb-1 block text-xs text-muted-foreground">Дата приёма</Label>
          <Input id="order-intake" type="date" value={intakeDate}
            onChange={(e) => setIntakeDate(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label htmlFor="order-delivery" className="mb-1 block text-xs text-muted-foreground">Выдача (дата/время)</Label>
          <Input id="order-delivery" type="datetime-local" value={deliveryAt}
            onChange={(e) => setDeliveryAt(e.target.value)} className="h-9" />
        </div>
      </div>

      {form.orderTimes.length > 1 && (
        <div>
          <Label htmlFor="order-urgency" className="mb-1 block text-xs text-muted-foreground">Срочность</Label>
          <select
            id="order-urgency" value={fastExecId} onChange={(e) => setFastExecId(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {form.orderTimes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <Label htmlFor="order-comment" className="mb-1 block text-xs text-muted-foreground">Комментарий</Label>
        <Textarea id="order-comment" placeholder="Примечание..." value={comment}
          onChange={(e) => setComment(e.target.value)} rows={2} />
      </div>

      {selected.length > 0 && (
        <div className="flex justify-between font-semibold text-sm border-t pt-2">
          <span>Итого</span><span>{fmtTenge(total)}</span>
        </div>
      )}

      {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? 'Создание...' : 'Создать заказ'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  )
}
