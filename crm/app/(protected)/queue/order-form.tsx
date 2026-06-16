'use client'

import { useEffect, useMemo, useState } from 'react'
import { createOrder } from '@/app/(protected)/queue/order/actions'
import { getOrderFormData, type OrderFormData } from '@/app/(protected)/queue/order/catalog'
import { getTripSlots } from '@/app/(protected)/queue/order/trip-slots'
import {
  CatalogColumn, WarehouseField, DeliverySection, DatesSection, OrderResult, CarpetSection,
  groupServices, matchesSearch, combineAddress,
  type DeliveryType, type OrderResultData, type CarpetLine,
} from '@/app/(protected)/queue/order/order-form-parts'
import { computeArea, estimateCarpetPrice } from '@/lib/agbis/carpet'
import { createClient } from '@/lib/supabase/client'
import { deriveEndOptions } from '@/lib/agbis/trips'
import { almatyTodayYMD } from '@/lib/agbis/order-dates'
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
  const [intakeDate, setIntakeDate] = useState(() => almatyTodayYMD())
  const [deliveryAt, setDeliveryAt] = useState('')
  const [fastExecId, setFastExecId] = useState('0')
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('self')
  const [street, setStreet] = useState('')
  const [house, setHouse] = useState('')
  const [apartment, setApartment] = useState('')
  const [floor, setFloor] = useState('')
  const [regionId, setRegionId] = useState('')
  const [carId, setCarId] = useState('')
  const [tripHr, setTripHr] = useState('')
  const [tripHrTo, setTripHrTo] = useState('')
  const [tripSlots, setTripSlots] = useState<string[]>([])
  const [carpets, setCarpets] = useState<CarpetLine[]>([])
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
        setCarId(res.data.cars[0]?.id ?? res.data.warehouses[0]?.id ?? '')
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
        if (active && addr) setStreet((a) => a || addr)
      } catch (err) {
        console.error('[order-form.address]', err)
      }
    }
    void loadAddress()
    return () => { active = false }
  }, [clientId])

  const tripDateYMD = deliveryType === 'dropoff' ? deliveryAt.slice(0, 10) : intakeDate

  // Load free start-hour slots when a выезд is configured (R10: failure clears slots, never blocks).
  useEffect(() => {
    let active = true
    const loadSlots = async () => {
      if (deliveryType === 'self' || !carId || !tripDateYMD) { if (active) setTripSlots([]); return }
      try {
        const res = await getTripSlots({ dateYMD: tripDateYMD, carId })
        if (active) setTripSlots(res.success ? res.slots : [])
      } catch (err) {
        console.error('[order-form.slots]', err)
        if (active) setTripSlots([])
      }
    }
    void loadSlots()
    return () => { active = false }
  }, [deliveryType, carId, tripDateYMD])

  const grouped = useMemo(
    () => groupServices((form?.services ?? []).filter((s) => matchesSearch(s, search))),
    [form, search],
  )
  const priceOf = useMemo(() => new Map((form?.services ?? []).map((s) => [s.tovarId, s])), [form])
  const endOptions = useMemo(() => deriveEndOptions(tripSlots, tripHr), [tripSlots, tripHr])

  const selected = Object.entries(qty).filter(([, q]) => q > 0)
  const carpetTotal = carpets.reduce((sum, c) => sum + estimateCarpetPrice(computeArea(c.shapeFlt, c.dim1, c.dim2), c.pricePerM2), 0)
  const total = selected.reduce((sum, [id, q]) => sum + (priceOf.get(id)?.price ?? 0) * q, 0) + carpetTotal
  const hasItems = selected.length > 0 || carpets.length > 0
  const tripReady = deliveryType === 'self' || (!!street.trim() && !!regionId && !!carId && !!tripHr && !!tripHrTo)
  const canSubmit = !submitting && hasItems && scladId.length > 0 && tripReady

  const toggle = (id: string) => setQty((p) => ({ ...p, [id]: p[id] > 0 ? 0 : 1 }))
  const setItemQty = (id: string, v: number) => setQty((p) => ({ ...p, [id]: Math.max(0, Math.floor(v) || 0) }))

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
    const isSelf = deliveryType === 'self'
    const res = await createOrder({
      clientId, items, carpets, scladId,
      comment: comment.trim() || undefined,
      intakeDate, deliveryAt: deliveryAt || undefined, fastExecId,
      deliveryType,
      deliveryAddress: isSelf ? undefined : combineAddress(street, house, apartment, floor),
      regionId: isSelf ? undefined : regionId,
      carId: isSelf ? undefined : carId,
      tripHr: isSelf ? undefined : tripHr,
      tripHrTo: isSelf ? undefined : tripHrTo,
    })
    setSubmitting(false)
    if (!res.success) { setError(res.error); return }
    setResult({ agbisStatus: res.order.agbisStatus, dorId: res.order.dorId, amount: res.order.amount, tripId: res.order.tripId })
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
          onSearch={setSearch} onToggle={toggle} onQty={setItemQty} />
        <div className="space-y-3">
          <WarehouseField scladId={scladId} warehouses={form.warehouses} onChange={setScladId} />
          <DeliverySection
            type={deliveryType} onType={setDeliveryType} form={form}
            street={street} onStreet={setStreet}
            house={house} onHouse={setHouse}
            apartment={apartment} onApartment={setApartment}
            floor={floor} onFloor={setFloor}
            regionId={regionId} onRegion={setRegionId}
            carId={carId} onCar={setCarId}
            tripHr={tripHr} onHr={setTripHr} tripHrTo={tripHrTo} onHrTo={setTripHrTo}
            slots={tripSlots} endOptions={endOptions}
          />
          <CarpetSection types={form.carpetTypes} shapes={form.carpetShapes} carpets={carpets}
            onAdd={(c) => setCarpets((p) => [...p, c])}
            onRemove={(i) => setCarpets((p) => p.filter((_, idx) => idx !== i))} />
          <DatesSection intakeDate={intakeDate} onIntake={setIntakeDate}
            deliveryAt={deliveryAt} onDelivery={setDeliveryAt}
            orderTimes={form.orderTimes} fastExecId={fastExecId} onUrgency={setFastExecId} />
          <div>
            <Label htmlFor="order-comment" className="mb-1 block text-xs text-muted-foreground">Комментарий</Label>
            <Textarea id="order-comment" placeholder="Примечание..." value={comment}
              onChange={(e) => setComment(e.target.value)} rows={2} />
          </div>
          {hasItems && (
            <div className="flex justify-between font-semibold text-sm border-t pt-2">
              <span>Итого{carpetTotal > 0 ? ' (с коврами — ориентир)' : ''}</span><span>{fmtTenge(total)}</span>
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
