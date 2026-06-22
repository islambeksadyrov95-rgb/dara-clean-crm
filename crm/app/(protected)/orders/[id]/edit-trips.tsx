'use client'

import { useEffect, useState } from 'react'
import { getTripCars, updateOrderTrips } from '@/app/(protected)/queue/order/actions'
import type { CarOption } from '@/lib/agbis/order-lists'
import { TripBlock, emptyTrip, tripChoiceToArm, deliveryArm, isTripChoiceReady, parseAddress, type TripChoice } from '@/app/(protected)/queue/order/order-form-parts'
import type { TripView } from '@/app/(protected)/orders/order-detail-shape'
import { Button } from '@/components/ui/button'

/**
 * Wave 2 (D-2026-06-17 unified) — edit an order's выезд after creation in ONE block: машина/самовывоз,
 * адрес, и обе даты (забор/выдача). No Забор/Выдача split — обе ноги шлются на один адрес/машину.
 * Submits to updateOrderTrips (server reconciles both arms + persists dates; ownership via RLS).
 * Both arms share the same address/car, so the choice is derived from whichever arm row exists.
 */

// Состояние привязки ноги выезда к заказу в Агбисе. Честно: sync_status='synced' значит лишь
// «TripOrder прошёл», НЕ «привязан к заказу» — привязку делает локальный агент (Firebird junction),
// помечая order_trips.bound_at. До этого выезд висит «по клиенту», в заказе его не видно.
function tripBindingLabel(t: TripView): { text: string; cls: string } {
  if (t.syncStatus === 'failed') return { text: 'ошибка отправки в Агбис', cls: 'text-red-600' }
  if (t.syncStatus !== 'synced') return { text: 'не отправлен', cls: 'text-[#8a877e]' }
  if (t.boundAt) return { text: 'привязан к заказу', cls: 'text-emerald-600' }
  return { text: 'отправлен, ждёт привязки', cls: 'text-amber-600' }
}

function tripFromTrips(trips: TripView[]): TripChoice {
  const t = trips[0] // both arms carry the same address/car; самовывоз → no rows
  if (!t) return emptyTrip('self') // existing самовывоз order — reflect actual state, not the выезд default
  const { street, house, apartment } = parseAddress(t.address)
  return { mode: 'trip', carId: t.carId ?? '', address: street, house, apartment }
}

type Props = {
  orderId: string
  trips: TripView[]
  intakeAt: string | null
  deliveryAt: string | null
  onCancel?: () => void // опционален: при инлайн-показе (всегда раскрыт) отмена не нужна
  onSaved: () => void
}

export function EditTripsForm({ orderId, trips, intakeAt, deliveryAt, onCancel, onSaved }: Props) {
  const [cars, setCars] = useState<readonly CarOption[]>([])
  const [carsLoading, setCarsLoading] = useState(true)
  const [carsError, setCarsError] = useState(false)
  const [trip, setTrip] = useState<TripChoice>(() => tripFromTrips(trips))
  const [intake, setIntake] = useState(intakeAt ?? '')
  const [delivery, setDelivery] = useState(deliveryAt ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await getTripCars()
        if (!active) return
        if (res.success) setCars(res.cars)
        else setCarsError(true)
      } catch (err) {
        console.error('[edit-trips.cars]', err)
        if (active) setCarsError(true)
      } finally {
        if (active) setCarsLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const res = await updateOrderTrips({
        orderId,
        pickup: tripChoiceToArm(trip),
        delivery: deliveryArm(trip, delivery),
        intakeDate: intake || undefined,
        deliveryAt: delivery || undefined,
      })
      if (!res.success) { setError(res.error); return }
      onSaved()
    } catch {
      setError('Не удалось сохранить выезд — попробуйте ещё раз')
    } finally {
      setSaving(false)
    }
  }

  const canSave = !saving && isTripChoiceReady(trip)

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="text-sm font-medium">Выезд и доставка</div>
      {carsError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">Не удалось загрузить список машин</div>
      )}
      {/* Честный статус привязки выезда к заказу в Агбисе (по каждой ноге). */}
      {trips.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/30 px-3 py-2 text-xs">
          {trips.map((t) => {
            const b = tripBindingLabel(t)
            return (
              <div key={t.kind} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t.kind === 'pickup' ? 'Забор' : 'Выдача'} в Агбисе</span>
                <span className={`font-medium ${b.cls}`}>{b.text}</span>
              </div>
            )
          })}
        </div>
      )}
      {/* Адрес и даты доступны сразу; список машин подгружается в фоне (carsLoading). */}
      <TripBlock choice={trip} cars={cars} carsLoading={carsLoading}
        onChange={(patch) => setTrip((t) => ({ ...t, ...patch }))}
        intakeDate={intake} onIntake={setIntake}
        deliveryAt={delivery} onDelivery={setDelivery} />
      {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={handleSave} disabled={!canSave}>
          {saving ? 'Сохранение...' : 'Сохранить выезд'}
        </Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Отмена</Button>}
      </div>
    </div>
  )
}
