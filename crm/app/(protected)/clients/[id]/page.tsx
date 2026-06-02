'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { lockClient } from '../../queue/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SEGMENT_COLORS } from '@/lib/segments'

export const dynamic = 'force-dynamic'

const CALL_STATUS: Record<string, string> = {
  reached: 'Дозвонился',
  not_reached: 'Не дозвонился',
}

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

type ClientData = {
  id: string
  name: string
  phone: string
  address: string | null
  total_orders: number
  total_spent: number
  avg_order_value: number
  last_order_date: string | null
  rfm_segment: string
  days_since_last_order: number | null
}

type Order = {
  id: string
  services: string[]
  amount: number
  discount_percent: number
  discount_amount: number
  comment: string | null
  created_at: string
}

type CallLog = {
  id: string
  status: string
  created_at: string
}

export default function ClientCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [client, setClient] = useState<ClientData | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [clientRes, ordersRes, callsRes] = await Promise.all([
        supabase
          .from('client_segments')
          .select('*')
          .eq('id', id)
          .single(),
        supabase
          .from('orders')
          .select('id, services, amount, discount_percent, discount_amount, comment, created_at')
          .eq('client_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('call_logs')
          .select('id, status, created_at')
          .eq('client_id', id)
          .order('created_at', { ascending: false }),
      ])

      if (clientRes.data) {
        // client_segments не содержит address и avg_order_value, дозапрашиваем из clients
        const { data: full } = await supabase
          .from('clients')
          .select('address, avg_order_value')
          .eq('id', id)
          .single()

        setClient({
          ...(clientRes.data as ClientData),
          address: full?.address ?? null,
          avg_order_value: full?.avg_order_value ?? 0,
        })
      }

      setOrders((ordersRes.data as Order[]) ?? [])
      setCallLogs((callsRes.data as CallLog[]) ?? [])
      setLoading(false)
    }

    load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center">Загрузка...</div>
    )
  }

  if (!client) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground mb-4">Клиент не найден</p>
        <Button variant="outline" onClick={() => router.push('/clients')}>
          Назад к списку
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/clients')}
        >
          ← Назад к списку
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const res = await lockClient(id)
            if (!res.success) { toast.error(res.error); return }
            router.push('/queue')
          }}
        >
          Позвонить
        </Button>
      </div>

      {/* Шапка клиента */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <Badge
            variant="outline"
            className={SEGMENT_COLORS[client.rfm_segment] ?? ''}
          >
            {client.rfm_segment}
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Телефон</p>
            <a href={`tel:${client.phone}`} className="font-medium hover:underline">{client.phone}</a>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Адрес</p>
            <p className="font-medium">{client.address ?? '—'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Заказов</p>
            <p className="font-medium">{client.total_orders}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Потрачено</p>
            <p className="font-medium">{fmtMoney.format(client.total_spent)} ₸</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Средний чек</p>
            <p className="font-medium">{fmtMoney.format(client.avg_order_value)} ₸</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Последний заказ</p>
            <p className="font-medium">{formatDate(client.last_order_date)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Дней без заказа</p>
            <p className="font-medium">
              {client.days_since_last_order != null ? `${client.days_since_last_order} дн.` : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Заказы */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Заказы ({orders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">Заказов пока нет</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Услуги</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="text-right">Скидка</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{formatDateTime(o.created_at)}</TableCell>
                    <TableCell>{o.services.join(', ')}</TableCell>
                    <TableCell className="text-right">
                      {fmtMoney.format(o.amount)} ₸
                    </TableCell>
                    <TableCell className="text-right">
                      {o.discount_percent > 0
                        ? `${o.discount_percent}% (${fmtMoney.format(o.discount_amount)} ₸)`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.comment ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Звонки */}
      <Card>
        <CardHeader>
          <CardTitle>Журнал звонков ({callLogs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {callLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm">Звонков пока нет</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата и время</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callLogs.map((cl) => (
                  <TableRow key={cl.id}>
                    <TableCell>{formatDateTime(cl.created_at)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          cl.status === 'reached'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {CALL_STATUS[cl.status] ?? cl.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
