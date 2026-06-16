'use client'

import { useEffect, useState } from 'react'
import { getOrderFormData, type OrderFormData } from '@/app/(protected)/queue/order/catalog'
import { updateOrderTrips } from '@/app/(protected)/queue/order/actions'
import { TripArmSection, emptyArm, armToPayload, isArmReady, type ArmState } from '@/app/(protected)/queue/order/order-form-parts'
import type { TripView } from '@/app/(protected)/orders/order-detail-shape'
import { Button } from '@/components/ui/button'

/**
 * Wave 2 — edit an order's trip arms (Забор/Выдача) after creation: fill самовывоз→выезд, change
 * address/car, or cancel a выезд. Submits to updateOrderTrips (server reconciles each arm in Agbis;
 * ownership enforced server-side via RLS). The stored выезд address is a single string, so it goes
 * back into the «street» field (house/кв/этаж are recombined on save). Cars come from the catalog.
 */

function armFromTrip(trip: TripView | undefined): ArmState {
  if (!trip) return emptyArm()
  return { mode: 'trip', street: trip.address, house: '', apartment: '', floor: '', carId: trip.carId ?? '' }
}

type Props = { orderId: string; trips: TripView[]; onCancel: () => void; onSaved: () => void }

export function EditTripsForm({ orderId, trips, onCancel, onSaved }: Props) {
  const [cars, setCars] = useState<OrderFormData['cars']>([])
  const [carsState, setCarsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pickup, setPickup] = useState<ArmState>(() => armFromTrip(trips.find((t) => t.kind === 'pickup')))
  const [delivery, setDelivery] = useState<ArmState>(() => armFromTrip(trips.find((t) => t.kind === 'delivery')))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await getOrderFormData()
        if (!active) return
        if (res.success) { setCars(res.data.cars); setCarsState('ready') }
        else setCarsState('error')
      } catch (err) {
        console.error('[edit-trips.cars]', err)
        if (active) setCarsState('error')
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    const res = await updateOrderTrips({ orderId, pickup: armToPayload(pickup), delivery: armToPayload(delivery) })
    setSaving(false)
    if (!res.success) { setError(res.error); return }
    onSaved()
  }

  const canSave = !saving && isArmReady(pickup) && isArmReady(delivery)

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="text-sm font-medium">Редактирование выездов</div>
      {carsState === 'loading' && <div className="text-muted-foreground py-4 text-center text-sm">Загрузка машин...</div>}
      {carsState === 'error' && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">Не удалось загрузить список машин</div>
      )}
      {carsState === 'ready' && (
        <>
          <TripArmSection label="Забор" arm={pickup} cars={cars} onChange={(patch) => setPickup((a) => ({ ...a, ...patch }))} />
          <TripArmSection label="Выдача" arm={delivery} cars={cars} onChange={(patch) => setDelivery((a) => ({ ...a, ...patch }))} />
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleSave} disabled={!canSave}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Отмена</Button>
          </div>
        </>
      )}
      {carsState !== 'ready' && (
        <Button size="sm" variant="ghost" onClick={onCancel}>Отмена</Button>
      )}
    </div>
  )
}
