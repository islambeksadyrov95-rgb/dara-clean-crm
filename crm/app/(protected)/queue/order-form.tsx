'use client'

import { useEffect, useMemo, useState } from 'react'
import { createOrder } from '@/app/(protected)/queue/order/actions'
import { getOrderFormData, type OrderFormData } from '@/app/(protected)/queue/order/catalog'
import {
  CatalogColumn, WarehouseField, TripBlock, UrgencySection, DiscountSection, OrderResult,
  groupServices, matchesSearch, emptyTrip, tripChoiceToArm, isTripChoiceReady,
  type TripChoice, type OrderResultData, type CarpetLine, type CarpetCfg,
} from '@/app/(protected)/queue/order/order-form-parts'
import { computeArea, estimateCarpetPrice } from '@/lib/agbis/carpet'
import { computeDiscount } from '@/app/(protected)/queue/order/order-build'
import { createClient } from '@/lib/supabase/client'
import { almatyNowLocal } from '@/lib/agbis/order-dates'
import { fmtTenge } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  clientId: string
  clientName: string
  totalOrders?: number
  onDone: () => void
  onCancel: () => void
}

export function OrderForm({ clientId, clientName, onDone, onCancel }: Props) {
  const [form, setForm] = useState<OrderFormData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [scladId, setScladId] = useState('')
  const [comment, setComment] = useState('')
  const [intakeDate, setIntakeDate] = useState(() => almatyNowLocal())
  const [deliveryAt, setDeliveryAt] = useState('')
  const [fastExecId, setFastExecId] = useState('0')
  const [trip, setTrip] = useState<TripChoice>(() => emptyTrip())
  const [carpetCfg, setCarpetCfg] = useState<Record<string, CarpetCfg>>({})
  const [discountPercent, setDiscountPercent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OrderResultData | null>(null)

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
        // Default = Самовывоз (carId ''); the manager picks a машина only when it's a выезд.
      } catch {
        if (active) setLoadError('Не удалось загрузить каталог услуг')
      }
    }
    void load()
    return () => { active = false }
  }, [])

  // Prefill the trip address with the client's saved address (best-effort).
  useEffect(() => {
    let active = true
    const loadAddress = async () => {
      try {
        const { data } = await createClient().from('clients').select('address').eq('id', clientId).single()
        const addr = data?.address
        if (active && addr) setTrip((t) => ({ ...t, address: t.address || addr }))
      } catch (err) {
        console.error('[order-form.address]', err)
      }
    }
    void loadAddress()
    return () => { active = false }
  }, [clientId])

  const grouped = useMemo(
    () => groupServices((form?.services ?? []).filter((s) => matchesSearch(s, search))),
    [form, search],
  )
  const priceOf = useMemo(() => new Map((form?.services ?? []).map((s) => [s.tovarId, s])), [form])

  const carpets = useMemo<CarpetLine[]>(() => {
    const out: CarpetLine[] = []
    for (const [strId, c] of Object.entries(carpetCfg)) {
      const type = form?.carpetTypes.find((t) => t.strId === strId)
      if (!type || !c.shapeFlt) continue
      const d1 = Number(c.dim1) || 0
      const d2 = Number(c.dim2) || 0
      if (computeArea(c.shapeFlt, d1, d2) <= 0) continue
      out.push({ typeStrId: strId, typeName: type.name, pricePerM2: type.pricePerM2, shapeFlt: c.shapeFlt, dim1: d1, dim2: d2 })
    }
    return out
  }, [form, carpetCfg])

  const selected = Object.entries(qty).filter(([, q]) => q > 0)
  const carpetTotal = carpets.reduce((sum, c) => sum + estimateCarpetPrice(computeArea(c.shapeFlt, c.dim1, c.dim2), c.pricePerM2), 0)
  const total = selected.reduce((sum, [id, q]) => sum + (priceOf.get(id)?.price ?? 0) * q, 0) + carpetTotal
  const hasItems = selected.length > 0 || carpets.length > 0
  const discount = computeDiscount(total, Number(discountPercent) || 0)
  const finalTotal = total - discount.amount
  const tripReady = isTripChoiceReady(trip)
  const canSubmit = !submitting && hasItems && scladId.length > 0 && tripReady

  const toggle = (id: string) => setQty((p) => ({ ...p, [id]: p[id] > 0 ? 0 : 1 }))
  const setItemQty = (id: string, v: number) => setQty((p) => ({ ...p, [id]: Math.max(0, Math.floor(v) || 0) }))

  const toggleCarpet = (strId: string) =>
    setCarpetCfg((p) => {
      if (p[strId]) { const { [strId]: _omit, ...rest } = p; return rest }
      return { ...p, [strId]: { shapeFlt: '', dim1: '', dim2: '' } }
    })
  const setCarpetField = (strId: string, field: keyof CarpetCfg, value: string) =>
    setCarpetCfg((p) => ({ ...p, [strId]: { ...p[strId], [field]: value } }))

  const buildItems = () =>
    selected.flatMap(([id, q]) => {
      const svc = priceOf.get(id)
      return svc ? [{ tovarId: id, name: svc.name, qty: q, unitPrice: svc.price }] : []
    })

  const handleSubmit = async () => {
    setError(null)
    const items = buildItems()
    if (!items.length && carpets.length === 0) { setError('Выберите услугу или ковёр'); return }
    setSubmitting(true)
    try {
      const res = await createOrder({
        clientId, items, carpets, scladId,
        comment: comment.trim() || undefined,
        intakeDate, deliveryAt: deliveryAt || undefined, fastExecId,
        pickup: tripChoiceToArm(trip),
        delivery: tripChoiceToArm(trip),
        discountPercent: Number(discountPercent) || 0,
      })
      if (!res.success) { setError(res.error); return }
      setResult({ agbisStatus: res.order.agbisStatus, dorId: res.order.dorId, amount: res.order.amount, tripIds: res.order.tripIds })
    } catch {
      // Без finally кнопка «Создать заказ» залипла бы (canSubmit = !submitting).
      setError('Не удалось создать заказ — проверьте связь и попробуйте ещё раз')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) return <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{loadError}</div>
  if (!form) return <div className="text-muted-foreground py-6 text-center text-sm">Загрузка каталога...</div>
  if (!form.services.length) return <div className="text-muted-foreground py-6 text-center text-sm">Каталог услуг пуст</div>
  if (result) return <OrderResult result={result} onDone={onDone} />

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">Новый заказ — {clientName}</div>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <CatalogColumn grouped={grouped} qty={qty} search={search}
          onSearch={setSearch} onToggle={toggle} onQty={setItemQty}
          carpetTypes={form.carpetTypes} carpetShapes={form.carpetShapes}
          carpetCfg={carpetCfg} onCarpetToggle={toggleCarpet} onCarpetField={setCarpetField} />
        <div className="space-y-3">
          <WarehouseField scladId={scladId} warehouses={form.warehouses} onChange={setScladId} />
          <TripBlock choice={trip} cars={form.cars}
            onChange={(patch) => setTrip((t) => ({ ...t, ...patch }))}
            intakeDate={intakeDate} onIntake={setIntakeDate}
            deliveryAt={deliveryAt} onDelivery={setDeliveryAt} />
          <UrgencySection orderTimes={form.orderTimes} fastExecId={fastExecId} onUrgency={setFastExecId} />
          <DiscountSection value={discountPercent} onValue={setDiscountPercent} />
          <div>
            <Label htmlFor="order-comment" className="mb-1 block text-xs text-muted-foreground">Комментарий</Label>
            <Textarea id="order-comment" placeholder="Примечание..." value={comment}
              onChange={(e) => setComment(e.target.value)} rows={2} />
          </div>
          {hasItems && (
            <div className="space-y-1 border-t pt-2 text-sm">
              {discount.amount > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Подытог</span><span>{fmtTenge(total)}</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>Скидка{discount.percent > 0 ? ` ${discount.percent}%` : ''}</span><span>−{fmtTenge(discount.amount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-semibold">
                <span>Итого{carpetTotal > 0 ? ' (с коврами — ориентир)' : ''}</span><span>{fmtTenge(finalTotal)}</span>
              </div>
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
      </div>
    </div>
  )
}
