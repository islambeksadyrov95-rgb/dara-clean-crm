'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { lockClient } from '../../queue/actions'
import { makeSipCall } from '@/lib/vpbx/actions'
import { assignManager, getManagers, getClientCardData } from '../actions'
import { getUserRole } from '@/lib/auth/get-user-role'
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
import { colorForSegment, segmentNames, computeSegment, DEFAULT_SEGMENT_RULES, type SegmentConfig } from '@/lib/segments'
import { bulkAssignSegment } from '../actions'
import { getSegmentRules } from '../../settings/actions'

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
  const [segmentConfig, setSegmentConfig] = useState<SegmentConfig>(DEFAULT_SEGMENT_RULES)
  const [loading, setLoading] = useState(true)
  const [reassigning, setReassigning] = useState(false)
  const [calling, setCalling] = useState(false)
  const [hasSip, setHasSip] = useState(true) // optimistic: avoid flicker before user loads

  // Настроенные правила сегментации (названия, цвета) для бейджа и редактора
  useEffect(() => {
    getSegmentRules()
      .then(setSegmentConfig)
      .catch((err) => console.warn('Не удалось загрузить правила сегментации, используются дефолтные:', err))
  }, [])

  // Ручная смена сегмента клиента (override === null → сброс на авто-расчёт по правилам).
  const handleSetClientSegment = async (override: string | null) => {
    if (!client) return
    const res = await bulkAssignSegment([client.id], override)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    const newSeg = override ?? computeSegment(client.total_orders, client.days_since_last_order, segmentConfig)
    setClient({ ...client, rfm_segment: newSeg })
    toast.success('Сегмент обновлён')
  }

  useEffect(() => {
    async function load() {
      setLoading(true)

      // Проверка роли
      const { data: { user } } = await supabase.auth.getUser()
      const adminRole = getUserRole(user ?? null) === 'admin'
      setIsAdmin(adminRole)
      setHasSip(Boolean(user?.user_metadata?.sip_extension || user?.user_metadata?.sip_number))

      const [cardData, managersList] = await Promise.all([
        getClientCardData(id),
        adminRole ? getManagers() : Promise.resolve([]),
      ])

      if (cardData.success && cardData.client) {
        setClient(cardData.client)
        setOrders(cardData.orders)
        setCallLogs(cardData.callLogs)
      } else {
        toast.error(cardData.error || 'Ошибка при загрузке данных клиента')
      }

      setManagers(managersList as Manager[])
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
            disabled={calling || !hasSip}
            title={!hasSip ? 'Укажите внутренний SIP-номер в Настройках → Личные настройки' : undefined}
            onClick={async () => {
              if (!client) return
              setCalling(true)
              // 1) Инициируем звонок через АТС (зазвонит SIP-софтфон менеджера).
              const call = await makeSipCall(client.phone, id)
              if (!call.success) { toast.error(call.error); setCalling(false); return }
              toast.success('Звонок инициирован — отвечайте на софтфоне')
              // 2) Берём клиента в работу и переходим в очередь для фиксации итога.
              const lock = await lockClient(id)
              if (!lock.success) { toast.error(lock.error); setCalling(false); return }
              // Передаём id клиента (открыть именно его) и id звонка (привязать итог).
              const params = new URLSearchParams({ client: id })
              if (call.externalCallId) params.set('call', call.externalCallId)
              router.push(`/queue?${params.toString()}`)
            }}
          >
            {calling ? 'Звоним…' : 'Позвонить'}
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
            className={colorForSegment(client.rfm_segment, segmentConfig)}
          >
            {client.rfm_segment}
          </Badge>
          {isAdmin && (
            <select
              className="h-7 rounded-md border border-input bg-background px-2 text-xs cursor-pointer focus:outline-none"
              defaultValue=""
              title="Изменить сегмент клиента"
              onChange={async (e) => {
                const val = e.target.value
                if (!val) return
                await handleSetClientSegment(val === '__auto__' ? null : val)
                e.target.value = ''
              }}
            >
              <option value="" disabled>Изменить сегмент…</option>
              <option value="__auto__">Авто (по правилам)</option>
              {segmentNames(segmentConfig).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
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
