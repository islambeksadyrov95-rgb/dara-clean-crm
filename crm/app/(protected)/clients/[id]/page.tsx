'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { lockClient } from '../../queue/actions'
import { assignManager, getManagers, getClientCallHistoryWithNames } from '../actions'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SEGMENT_COLORS } from '@/lib/segments'

export const dynamic = 'force-dynamic'

const CALL_STATUS: Record<string, string> = {
  reached: 'Дозвонился',
  not_reached: 'Не дозвонился',
  callback: 'Перезвонить',
  declined: 'Отказ',
  not_relevant: 'Не актуально',
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
  assigned_manager_id: string | null
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
  sub_status: string | null
  reason: string | null
  notes: string | null
  created_at: string
  manager_name: string
}

type Manager = {
  id: string
  name: string
  email: string
}

export default function ClientCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [client, setClient] = useState<ClientData | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reassigning, setReassigning] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)

      // Проверка роли
      const { data: { user } } = await supabase.auth.getUser()
      const adminRole = user?.user_metadata?.role === 'admin'
      setIsAdmin(adminRole)

      const [clientRes, ordersRes, callsData, managersList] = await Promise.all([
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
        getClientCallHistoryWithNames(id),
        adminRole ? getManagers() : Promise.resolve([]),
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
      setCallLogs(callsData)
      setManagers(managersList)
      setLoading(false)
    }

    load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAssignManager = async (managerId: string | null) => {
    setReassigning(true)
    const targetId = !managerId || managerId === 'unassigned' ? null : managerId
    const res = await assignManager(id, targetId)
    if (res.success) {
      toast.success('Ответственный менеджер изменен')
      setClient(prev => prev ? { ...prev, assigned_manager_id: targetId } : null)
    } else {
      toast.error(res.error)
    }
    setReassigning(false)
  }

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
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
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

        {/* Назначение менеджера (доступно только админу) */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-semibold">Ответственный:</span>
            <Select
              disabled={reassigning}
              value={client.assigned_manager_id || 'unassigned'}
              onValueChange={handleAssignManager}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs bg-white border-[#ebe9e4]">
                <SelectValue placeholder="Выберите ответственного" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Общая очередь</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Шапка клиента */}
      <div className="mb-6 bg-white border border-[#ebe9e4] rounded-xl p-5 shadow-xs">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-2xl font-bold text-foreground leading-tight">{client.name}</h1>
          <Badge
            variant="outline"
            className={SEGMENT_COLORS[client.rfm_segment] ?? ''}
          >
            {client.rfm_segment}
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Телефон</p>
            <a href={`tel:${client.phone}`} className="font-semibold text-foreground hover:underline">{client.phone}</a>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Адрес</p>
            <p className="font-semibold text-foreground">{client.address ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Заказов</p>
            <p className="font-semibold text-foreground">{client.total_orders}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Потрачено</p>
            <p className="font-semibold text-foreground">{fmtMoney.format(client.total_spent)} ₸</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Средний чек</p>
            <p className="font-semibold text-foreground">{fmtMoney.format(client.avg_order_value)} ₸</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Последний заказ</p>
            <p className="font-semibold text-foreground">{formatDate(client.last_order_date)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Дней без заказа</p>
            <p className="font-semibold text-foreground">
              {client.days_since_last_order != null ? `${client.days_since_last_order} дн.` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Ответственный</p>
            <p className="font-semibold text-foreground text-xs">
              {client.assigned_manager_id
                ? (managers.find(m => m.id === client.assigned_manager_id)?.name || 'Закреплен')
                : 'Общая очередь'}
            </p>
          </div>
        </div>
      </div>

      {/* Заказы */}
      <Card className="mb-6 border-[#ebe9e4] rounded-xl overflow-hidden shadow-xs">
        <CardHeader className="pb-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb]">
          <CardTitle className="text-base font-semibold">Заказы ({orders.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm p-4">Заказов пока нет</p>
          ) : (
            <Table>
              <TableHeader className="bg-[#fcfcfb]">
                <TableRow className="border-[#ebe9e4]">
                  <TableHead>Дата</TableHead>
                  <TableHead>Услуги</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="text-right">Скидка</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30">
                    <TableCell className="text-sm">{formatDateTime(o.created_at)}</TableCell>
                    <TableCell className="font-medium text-sm">{o.services.join(', ')}</TableCell>
                    <TableCell className="text-right font-bold text-sm">
                      {fmtMoney.format(o.amount)} ₸
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {o.discount_percent > 0
                        ? `${o.discount_percent}% (${fmtMoney.format(o.discount_amount)} ₸)`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
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
      <Card className="border-[#ebe9e4] rounded-xl overflow-hidden shadow-xs">
        <CardHeader className="pb-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb]">
          <CardTitle className="text-base font-semibold">Журнал звонков ({callLogs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {callLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm p-4">Звонков пока нет</p>
          ) : (
            <Table>
              <TableHeader className="bg-[#fcfcfb]">
                <TableRow className="border-[#ebe9e4]">
                  <TableHead>Дата и время</TableHead>
                  <TableHead>Менеджер</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Заметка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callLogs.map((cl) => (
                  <TableRow key={cl.id} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30">
                    <TableCell className="text-xs">{formatDateTime(cl.created_at)}</TableCell>
                    <TableCell className="font-medium text-xs">{cl.manager_name}</TableCell>
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
                    <TableCell className="text-muted-foreground text-xs">
                      {cl.notes || '—'}
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
