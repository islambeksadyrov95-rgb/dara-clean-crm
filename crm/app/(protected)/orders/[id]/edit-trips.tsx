'use client'

import { useEffect, useState } from 'react'
import { getTripCars, updateOrderTrips } from '@/app/(protected)/queue/order/actions'
import type { CarOption } from '@/lib/agbis/order-lists'
import { TripBlock, emptyTrip, tripChoiceToArm, isTripChoiceReady, type TripChoice } from '@/app/(protected)/queue/order/order-form-parts'
import type { TripView } from '@/app/(protected)/orders/order-detail-shape'
import { Button } from '@/components/ui/button'

/**
 * Wave 2 (D-2026-06-17 unified) — edit an order's выезд after creation in ONE block: машина/самовывоз,
 * адрес, и обе даты (забор/выдача). No Забор/Выдача split — обе ноги шлются на один адрес/машину.
 * Submits to updateOrderTrips (server reconciles both arms + persists dates; ownership via RLS).
 * Both arms share the same address/car, so the choice is derived from whichever arm row exists.
 */

function tripFromTrips(trips: TripView[]): TripChoice {
  const t = trips[0] // both arms carry the same address/car; самовывоз → no rows
  if (!t) return emptyTrip('self') // existing самовывоз order — reflect actual state, not the выезд default
  return { mode: 'trip', carId: t.carId ?? '', address: t.address, apartment: '' }
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
        delivery: tripChoiceToArm(trip),
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
