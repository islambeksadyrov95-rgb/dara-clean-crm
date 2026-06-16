'use client'

import { useEffect, useState } from 'react'
import { getOrderDetail } from '@/app/(protected)/orders/order-detail'
import type { OrderDetail } from '@/app/(protected)/orders/order-detail-shape'
import { EditTripsForm } from './[id]/edit-trips'
import { Button } from '@/components/ui/button'

/**
 * Edit a CRM order's выезд straight from the orders list — no drill-into-the-card detour.
 * Loads the order detail (trips + dates) on open, then reuses EditTripsForm. History orders have no
 * editable выезд (trips live only on CRM orders), so they show a note instead. Errors generic (R1).
 */

type Props = { orderId: string; onClose: () => void; onSaved: () => void }

export function EditTripsModal({ orderId, onClose, onSaved }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await getOrderDetail(orderId)
        if (!active) return
        if (res.success) { setOrder(res.data); setState('ready') }
        else setState('error')
      } catch (err) {
        console.error('[edit-trips-modal]', err)
        if (active) setState('error')
      }
    }
    void load()
    return () => { active = false }
  }, [orderId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {state === 'loading' && (
          <div className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground shadow-xl">Загрузка заказа...</div>
        )}
        {state === 'error' && (
          <div className="space-y-3 rounded-xl border bg-white p-6 text-center shadow-xl">
            <p className="text-sm text-red-600">Не удалось загрузить заказ</p>
            <Button size="sm" variant="outline" onClick={onClose}>Закрыть</Button>
          </div>
        )}
        {state === 'ready' && order && order.source === 'crm' && (
          <div className="rounded-xl bg-white shadow-xl">
            <EditTripsForm orderId={order.id} trips={order.trips}
              intakeAt={order.intakeAt} deliveryAt={order.deliveryAt}
              onCancel={onClose} onSaved={onSaved} />
          </div>
        )}
        {state === 'ready' && order && order.source !== 'crm' && (
          <div className="space-y-3 rounded-xl border bg-white p-6 text-center shadow-xl">
            <p className="text-sm text-muted-foreground">Выезд можно редактировать только у заказов CRM</p>
            <Button size="sm" variant="outline" onClick={onClose}>Закрыть</Button>
          </div>
        )}
      </div>
    </div>
  )
}
