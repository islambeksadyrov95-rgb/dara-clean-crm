'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { getOrderDetail } from '@/app/(protected)/orders/order-detail'
import { updateOrderComment } from '@/app/(protected)/orders/actions'
import type { OrderDetail, TripView } from '@/app/(protected)/orders/order-detail-shape'
import { EditTripsForm } from './edit-trips'
import { toast } from 'sonner'
import { fmtTenge } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const DASH = '—'

/** One collapsed выезд line: both legs share the address (unified), so show it once + any non-synced flag. */
function tripsLine(trips: TripView[]): string {
  const address = trips[0]?.address ?? ''
  const pending = trips.find((t) => t.syncStatus && t.syncStatus !== 'synced')
  return pending ? `${address} (${pending.syncStatus})` : address
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || DASH}</span>
    </div>
  )
}

export default function OrderDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [editingComment, setEditingComment] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  useEffect(() => {
    if (!id) return
    let active = true
    const load = async () => {
      try {
        const res = await getOrderDetail(id)
        if (!active) return
        if (!res.success) { setError(res.error); setLoading(false); return }
        setOrder(res.data); setLoading(false)
      } catch {
        if (active) { setError('Не удалось загрузить заказ'); setLoading(false) }
      }
    }
    void load()
    return () => { active = false }
  }, [id, reloadKey])

  if (loading) return <div className="text-muted-foreground py-8 text-center">Загрузка...</div>
  if (error) return (
    <div className="py-8 text-center">
      <p className="text-red-600 mb-4">{error}</p>
      <Button variant="outline" onClick={() => router.back()}>Назад</Button>
    </div>
  )
  if (!order) return null

  const title = order.docNum ? `Заказ № ${order.docNum}` : order.dorId ? `Заказ (Агбис ${order.dorId})` : 'Заказ (черновик)'

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{order.source === 'crm' ? 'CRM' : 'История'}</Badge>
          {order.statusName && <Badge variant="outline">{order.statusName}</Badge>}
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-1">
        <Row label="Клиент" value={order.clientName} />
        <div className="text-right -mt-2">
          <Link href={`/clients/${order.clientId}`} className="text-xs text-blue-600 hover:underline">Открыть карточку клиента →</Link>
        </div>
        <Row label="Дата приёма" value={order.date} />
        <Row label="Выдача" value={order.dateOut} />
        <Row label="Приёмщик" value={order.receiver} />
        {order.source === 'crm' ? (
          <Row label="Выезд" value={order.trips.length === 0 ? 'Самовывоз' : tripsLine(order.trips)} />
        ) : (
          <Row label="Адрес" value={order.address} />
        )}
        {order.source === 'crm' && <Row label="Синхронизация" value={order.syncStatus} />}
        {order.source === 'crm' && editingComment ? (
          <div className="py-1 space-y-2">
            <span className="text-muted-foreground text-sm">Комментарий</span>
            <textarea rows={2} value={commentDraft} disabled={savingComment}
              onChange={(e) => setCommentDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
            <div className="flex gap-2">
              <Button size="sm" disabled={savingComment} onClick={async () => {
                setSavingComment(true)
                const res = await updateOrderComment(order.id, commentDraft || null)
                if (res.success) {
                  setOrder((prev) => prev ? { ...prev, comment: res.comment } : prev)
                  setEditingComment(false)
                  toast.success('Комментарий сохранён')
                } else { toast.error(res.error) }
                setSavingComment(false)
              }}>{savingComment ? 'Сохранение…' : 'Сохранить'}</Button>
              <Button size="sm" variant="ghost" disabled={savingComment} onClick={() => setEditingComment(false)}>Отмена</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between gap-4 py-1 text-sm">
            <span className="text-muted-foreground">Комментарий</span>
            <span className="text-right font-medium flex items-center gap-2">
              {order.comment || DASH}
              {order.source === 'crm' && (
                <button onClick={() => { setCommentDraft(order.comment ?? ''); setEditingComment(true) }}
                  className="text-xs text-blue-600 hover:underline">Изменить</button>
              )}
            </span>
          </div>
        )}
        {order.source === 'crm' && !editing && (
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Редактировать выезды</Button>
          </div>
        )}
      </div>

      {editing && order.source === 'crm' && (
        <EditTripsForm orderId={order.id} trips={order.trips}
          intakeAt={order.intakeAt} deliveryAt={order.deliveryAt}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); setReloadKey((k) => k + 1) }} />
      )}

      <div className="rounded-lg border p-4">
        <div className="text-sm font-medium mb-2">Позиции</div>
        {order.items.length === 0 ? (
          <div className="text-muted-foreground text-sm">Нет позиций</div>
        ) : (
          <div className="space-y-1">
            {order.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-4 text-sm">
                <span className="flex-1">{it.name}{it.qty > 1 ? ` × ${it.qty}` : ''}</span>
                <span className="text-muted-foreground">{fmtTenge(it.lineAmount)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-4 text-sm font-semibold border-t pt-1 mt-1">
              <span>Итого</span><span>{fmtTenge(order.amount)}</span>
            </div>
          </div>
        )}
      </div>

      <Button variant="ghost" size="sm" onClick={() => router.back()}>← Назад</Button>
    </div>
  )
}
