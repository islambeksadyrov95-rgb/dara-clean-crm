'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getOrderDetail } from '@/app/(protected)/orders/order-detail'
import type { OrderDetail } from '@/app/(protected)/orders/order-detail-shape'
import { fmtTenge } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const DASH = '—'
const DELIVERY_LABEL: Record<string, string> = { self: 'Самовывоз', pickup: 'Выезд — забрать', dropoff: 'Выезд — доставить' }

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || DASH}</span>
    </div>
  )
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { params.then(({ id: i }) => setId(i)) }, [params])

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
  }, [id])

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
        <Row label="Доставка" value={order.deliveryType ? (DELIVERY_LABEL[order.deliveryType] ?? order.deliveryType) : null} />
        <Row label="Адрес" value={order.address} />
        {order.source === 'crm' && <Row label="Синхронизация" value={order.syncStatus} />}
        <Row label="Комментарий" value={order.comment} />
      </div>

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
