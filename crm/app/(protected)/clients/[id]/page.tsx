'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { lockClient } from '../../queue/actions'
import { makeSipCall } from '@/lib/vpbx/actions'
import { assignManager, getManagers, getClientCardData, updateClientStickyNote, updateClientNextAction } from '../actions'
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
  next_action_at: string | null
  next_action_note: string | null
  sticky_note: string | null
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

// Историческая запись из order_history (нуллабельность строго по database.ts).
type OrderHistoryItem = {
  id: string
  order_date: string
  amount: number
  service: string | null
  address: string | null
  source: string
}

// Единый элемент ленты заказов: исторические (Агбис/Вручную) + боевые (CRM).
// Локальный union — источник правды лента склеивает сама (R8: не реэкспорт из lib).
type FeedSource = 'agbis' | 'crm' | 'manual'

type FeedItem = {
  key: string
  date: string // ISO (YYYY-MM-DD для истории, timestamp для боевых)
  service: string
  amount: number
  address: string
  source: FeedSource
}

const FEED_SOURCE_BADGE: Record<FeedSource, { label: string; className: string }> = {
  agbis: { label: 'Агбис', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  crm: { label: 'CRM', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  manual: { label: 'Вручную', className: 'bg-muted text-muted-foreground' },
}

const DASH = '—'

// Русское склонение слова «заказ» по числу.
function pluralOrders(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'заказ'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'заказа'
  return 'заказов'
}

// Дата YYYY-MM-DD из ISO-строки (для расчёта интервалов по календарным дням).
function dayKey(dateStr: string): string {
  return dateStr.slice(0, 10)
}

// Аналитика по ленте: число заказов, средний интервал (дни), сколько дней назад последний.
function buildFeedStats(feed: FeedItem[]): { count: number; avgInterval: number | null; lastDaysAgo: number | null } {
  const count = feed.length
  if (count === 0) return { count: 0, avgInterval: null, lastDaysAgo: null }

  const sortedDays = [...new Set(feed.map((f) => dayKey(f.date)))].sort()
  const maxDay = sortedDays[sortedDays.length - 1]

  const today = new Date()
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const lastMs = new Date(`${maxDay}T00:00:00`).getTime()
  const lastDaysAgo = Math.floor((todayMs - lastMs) / 86_400_000)

  if (sortedDays.length < 2) return { count, avgInterval: null, lastDaysAgo }

  let totalGap = 0
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(`${sortedDays[i - 1]}T00:00:00`).getTime()
    const curr = new Date(`${sortedDays[i]}T00:00:00`).getTime()
    totalGap += (curr - prev) / 86_400_000
  }
  const avgInterval = Math.round(totalGap / (sortedDays.length - 1))
  return { count, avgInterval, lastDaysAgo }
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
  const [orderHistory, setOrderHistory] = useState<OrderHistoryItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [segmentConfig, setSegmentConfig] = useState<SegmentConfig>(DEFAULT_SEGMENT_RULES)
  const [loading, setLoading] = useState(true)
  const [reassigning, setReassigning] = useState(false)
  const [calling, setCalling] = useState(false)
  const [hasSip, setHasSip] = useState(true) // optimistic: avoid flicker before user loads

  // Следующий шаг
  const [nextActionAt, setNextActionAt] = useState<string>('')
  const [nextActionNote, setNextActionNote] = useState<string>('')
  const [savingNextAction, setSavingNextAction] = useState(false)

  // Заметка о клиенте
  const [stickyNote, setStickyNote] = useState<string>('')
  const [savingStickyNote, setSavingStickyNote] = useState(false)

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
        setOrderHistory(cardData.orderHistory)
        setCallLogs(cardData.callLogs)
        setLoadError(null)
        // Инициализация полей редактирования из загруженных данных
        setNextActionAt(cardData.client.next_action_at
          ? cardData.client.next_action_at.slice(0, 16) // "YYYY-MM-DDTHH:MM" для datetime-local
          : '')
        setNextActionNote(cardData.client.next_action_note ?? '')
        setStickyNote(cardData.client.sticky_note ?? '')
      } else {
        setLoadError(cardData.error || 'Ошибка при загрузке данных клиента')
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

  // Склейка двух источников в единую ленту, сортировка по дате убыв.
  const historyFeed: FeedItem[] = orderHistory.map((h) => ({
    key: `h-${h.id}`,
    date: h.order_date,
    service: h.service ?? DASH,
    amount: h.amount,
    address: h.address ?? DASH,
    source: h.source === 'manual' ? 'manual' : 'agbis',
  }))
  const ordersFeed: FeedItem[] = orders.map((o) => ({
    key: `o-${o.id}`,
    date: o.created_at,
    service: o.services.length > 0 ? o.services.join(', ') : DASH,
    amount: o.amount,
    address: DASH,
    source: 'crm',
  }))
  const feed: FeedItem[] = [...historyFeed, ...ordersFeed].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
  const feedStats = buildFeedStats(feed)

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/queue/order/${id}`)}
          >
            Оформить заказ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/queue/whatsapp/${id}`)}
          >
            WhatsApp
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

      {/* Следующий шаг */}
      <div className="mb-6 bg-white border border-[#ebe9e4] rounded-xl p-5 shadow-xs">
        <h2 className="text-sm font-semibold text-foreground mb-3">Следующий шаг</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Дата и время</label>
            <input
              type="datetime-local"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={nextActionAt}
              disabled={savingNextAction}
              onChange={(e) => setNextActionAt(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground block mb-1">Заметка</label>
            <input
              type="text"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Что нужно сделать…"
              value={nextActionNote}
              disabled={savingNextAction}
              onChange={(e) => setNextActionNote(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={savingNextAction}
            onClick={async () => {
              setSavingNextAction(true)
              const isoAt = nextActionAt ? new Date(nextActionAt).toISOString() : null
              const res = await updateClientNextAction(id, isoAt, nextActionNote || null)
              if (res.success) {
                setClient((prev) => prev ? { ...prev, next_action_at: isoAt, next_action_note: nextActionNote || null } : null)
                toast.success('Следующий шаг сохранён')
              } else {
                toast.error(res.error)
              }
              setSavingNextAction(false)
            }}
          >
            {savingNextAction ? 'Сохранение…' : 'Сохранить'}
          </Button>
          {(client.next_action_at || client.next_action_note) && (
            <Button
              size="sm"
              variant="outline"
              disabled={savingNextAction}
              onClick={async () => {
                setSavingNextAction(true)
                const res = await updateClientNextAction(id, null, null)
                if (res.success) {
                  setNextActionAt('')
                  setNextActionNote('')
                  setClient((prev) => prev ? { ...prev, next_action_at: null, next_action_note: null } : null)
                  toast.success('Следующий шаг очищен')
                } else {
                  toast.error(res.error)
                }
                setSavingNextAction(false)
              }}
            >
              Очистить
            </Button>
          )}
        </div>
        {!client.next_action_at && !client.next_action_note && (
          <p className="text-xs text-muted-foreground mt-2">Не задан</p>
        )}
        {client.next_action_at && (
          <p className="text-xs text-muted-foreground mt-2">
            Запланировано: {formatDateTime(client.next_action_at)}
            {client.next_action_note && ` — ${client.next_action_note}`}
          </p>
        )}
      </div>

      {/* Заметка о клиенте */}
      <div className="mb-6 bg-white border border-[#ebe9e4] rounded-xl p-5 shadow-xs">
        <h2 className="text-sm font-semibold text-foreground mb-3">Заметка о клиенте</h2>
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          rows={3}
          placeholder="Заметка видна только менеджерам…"
          value={stickyNote}
          disabled={savingStickyNote}
          onChange={(e) => setStickyNote(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            disabled={savingStickyNote}
            onClick={async () => {
              setSavingStickyNote(true)
              const res = await updateClientStickyNote(id, stickyNote || null)
              if (res.success) {
                setClient((prev) => prev ? { ...prev, sticky_note: stickyNote || null } : null)
                toast.success('Заметка сохранена')
              } else {
                toast.error(res.error)
              }
              setSavingStickyNote(false)
            }}
          >
            {savingStickyNote ? 'Сохранение…' : 'Сохранить заметку'}
          </Button>
        </div>
      </div>

      {/* Заказы — единая лента: история (Агбис/Вручную) + боевые (CRM) */}
      <Card className="mb-6 border-[#ebe9e4] rounded-xl overflow-hidden shadow-xs">
        <CardHeader className="pb-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb]">
          <CardTitle className="text-base font-semibold">Заказы ({feed.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadError ? (
            <p className="text-destructive text-sm p-4">{loadError}</p>
          ) : feed.length === 0 ? (
            <p className="text-muted-foreground text-sm p-4">Заказов пока нет</p>
          ) : (
            <>
              <div className="px-4 py-2.5 text-xs text-muted-foreground border-b border-[#ebe9e4]/60 bg-[#fcfcfb]/40">
                {feedStats.count} {pluralOrders(feedStats.count)}
                {feedStats.avgInterval != null && ` · средний интервал ${feedStats.avgInterval} дн.`}
                {feedStats.lastDaysAgo != null && ` · последний ${feedStats.lastDaysAgo} дн. назад`}
              </div>
              <Table>
                <TableHeader className="bg-[#fcfcfb]">
                  <TableRow className="border-[#ebe9e4]">
                    <TableHead>Дата</TableHead>
                    <TableHead>Услуга</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Адрес</TableHead>
                    <TableHead>Источник</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feed.map((f) => (
                    <TableRow key={f.key} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30">
                      <TableCell className="text-sm">{formatDate(f.date)}</TableCell>
                      <TableCell className="font-medium text-sm">{f.service}</TableCell>
                      <TableCell className="text-right font-bold text-sm">
                        {f.amount > 0 ? `${fmtMoney.format(f.amount)} ₸` : DASH}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{f.address}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={FEED_SOURCE_BADGE[f.source].className}>
                          {FEED_SOURCE_BADGE[f.source].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
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
