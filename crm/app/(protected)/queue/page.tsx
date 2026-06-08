'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  lockClient, recordDisposition, saveCallTranscript,
  getClientCallHistory, getAttemptCount, getScheduledCallbacks, getDayStats as getDayStatsAction
} from './actions'
import type { CallStatus, CallSubStatus, DispositionInput } from './actions'
import { getSettings, type Discounts, type Scripts, type SalesPlan } from '../settings/actions'
import { makeSipCall } from '@/lib/vpbx/actions'
import { getManagers, bulkAssignManager, bulkAssignSegment } from '../clients/actions'
import { OrderForm } from './order-form'
import { WhatsAppPanel } from './whatsapp-panel'
import { CallTranscript, type CallTranscriptRef } from './call-transcript'
import { ScoreDisplay } from './score-display'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Phone, MessageSquare } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { SEGMENT_COLORS } from '@/lib/segments'
import { WazzupChatModal } from '@/components/wazzup-chat-modal'

// ─── Constants ───
const STATUS_LABELS: Record<string, string> = {
  reached: 'Дозвонился', not_reached: 'Не дозвонился',
  callback: 'Перезвонить', declined: 'Отказ', not_relevant: 'Не актуально',
  ordered: 'Заказ', callback_later: 'Перезвон', sent_whatsapp: 'WhatsApp',
  decline_expensive: 'Дорого', decline_competitor: 'Другая компания',
  decline_not_needed: 'Не нужно', decline_quality: 'Качество',
  decline_season: 'Не сезон', decline_other: 'Другое',
  wrong_number: 'Неверный номер', unavailable: 'Недоступен', blocked: 'Заблокировал',
  auto_3_strikes: '3 попытки',
}

const DECLINE_REASONS = [
  { value: 'decline_expensive', label: 'Дорого' },
  { value: 'decline_competitor', label: 'Есть другая компания' },
  { value: 'decline_not_needed', label: 'Не нужно сейчас' },
  { value: 'decline_quality', label: 'Недоволен качеством' },
  { value: 'decline_season', label: 'Не сезон' },
  { value: 'decline_other', label: 'Другое' },
] as const

const SEGMENT_DISCOUNT_KEY: Record<string, keyof Discounts> = {
  'Новый': 'new', 'Повторный': 'repeat', 'Постоянный': 'regular',
  'В риске': 'at_risk', 'Потерянный': 'lost',
}

function renderScript(template: string, name: string, days: number | null, discount: number): string {
  return template
    .replace(/\{имя\}/g, name)
    .replace(/\{дней\}/g, String(days ?? '?'))
    .replace(/\{скидка\}/g, String(discount))
}

const FILTER_PRESETS = [
  { label: 'Все', min: 1, max: 9999 },
  { label: 'Повторные (30-60)', min: 30, max: 60 },
  { label: 'В риске (60-120)', min: 60, max: 120 },
  { label: 'Потерянные (120+)', min: 120, max: 9999 },
] as const

const REFRESH_INTERVAL = 30_000

// ─── Types ───
type QueueClient = {
  id: string; name: string; phone: string; address: string | null; rfm_segment: string
  days_since_last_order: number | null; total_orders: number; total_spent: number
  last_order_date: string | null; last_called_at: string | null
  locked_by: string | null; locked_until: string | null
  assigned_manager_id: string | null
}
type CallHistoryEntry = { id: string; status: string; sub_status: string | null; reason: string | null; notes: string | null; created_at: string }
type ScheduledCallback = { id: string; clientId: string; clientName: string; clientPhone: string; time: string | null; notes: string | null }
type DayStats = {
  calls: number
  reached: number
  orders: number
  revenue: number
  planRevenuePerDay: number
  planOrdersPerDay: number
  dayTargetCalls: number
}
type CallPhase = 'level1' | 'reached_actions' | 'not_reached_actions' | 'decline_reason' | 'callback_schedule' | 'order' | 'whatsapp'

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function calledToday(lastCalledAt: string | null): boolean {
  if (!lastCalledAt) return false
  const now = new Date()
  const almatyOffset = 5 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + almatyOffset * 60000)
  const todayStart = new Date(almatyNow.getFullYear(), almatyNow.getMonth(), almatyNow.getDate())
  return new Date(lastCalledAt).getTime() >= todayStart.getTime() - almatyOffset * 60000
}

export default function QueuePage() {
  const supabase = createClient()
  const [clients, setClients] = useState<QueueClient[]>([])
  const [activePreset, setActivePreset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeClient, setActiveClient] = useState<QueueClient | null>(null)
  const [callPhase, setCallPhase] = useState<CallPhase>('level1')
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([])
  const [attemptCount, setAttemptCount] = useState(0)
  const [callbacks, setCallbacks] = useState<ScheduledCallback[]>([])
  
  // Статистика с дефолтными значениями
  const [stats, setStats] = useState<DayStats>({
    calls: 0, reached: 0, orders: 0, revenue: 0,
    planRevenuePerDay: 85000, planOrdersPerDay: 5, dayTargetCalls: 40
  })
  
  const [discounts, setDiscounts] = useState<Discounts>({ new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 })
  const [scriptTemplates, setScriptTemplates] = useState<Scripts>({})
  const [disposing, setDisposing] = useState(false)
  const [showCalledToday, setShowCalledToday] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)
  
  // Callback scheduling state
  const [cbDate, setCbDate] = useState('')
  const [cbTime, setCbTime] = useState('')
  const [cbNotes, setCbNotes] = useState('')
  
  // Decline reason state
  const [declineReason, setDeclineReason] = useState('')
  const [declineText, setDeclineText] = useState('')
  
  // Call scoring
  const [scoreResult, setScoreResult] = useState<{ score: number; summary: string; strengths: string[]; improvements: string[] } | null>(null)
  const [scoring, setScoring] = useState(false)
  
  // Сворачиваемые второпрепятственные блоки правой панели
  const [showHistory, setShowHistory] = useState(false)
  const [showRecord, setShowRecord] = useState(true)
  
  // Телефония & Wazzup
  const [calling, setCalling] = useState(false)
  const [showWazzupModal, setShowWazzupModal] = useState(false)
  const callTranscriptRef = useRef<CallTranscriptRef | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeClientRef = useRef<QueueClient | null>(null)

  const preset = FILTER_PRESETS[activePreset]

  // Массовое редактирование
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [managersMap, setManagersMap] = useState<Map<string, string>>(new Map())
  const [bulkAssigning, setBulkAssigning] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id)
        setIsAdmin(user.user_metadata?.role === 'admin')
      }
    })
    getSettings().then((s) => {
      setDiscounts(s.discounts)
      setScriptTemplates(s.scripts)
    })
    async function loadManagers() {
      const list = await getManagers()
      const m = new Map<string, string>()
      list.forEach((u) => m.set(u.id, u.name))
      setManagersMap(m)
    }
    loadManagers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStats = useCallback(async () => {
    const statsData = await getDayStatsAction()
    setStats(statsData)
  }, [])

  const fetchCallbacks = useCallback(async () => { setCallbacks(await getScheduledCallbacks()) }, [])

  const fetchQueue = useCallback(async () => {
    if (userId === null) return // Ждем загрузки userId

    let query = supabase
      .from('client_segments')
      .select('id, name, phone, address, rfm_segment, days_since_last_order, total_orders, total_spent, last_order_date, last_called_at, locked_by, locked_until, assigned_manager_id', { count: 'exact' })
      .gte('days_since_last_order', preset.min).lte('days_since_last_order', preset.max)

    // Жесткое распределение: если менеджер — показываем только закрепленных за ним.
    // Админ видит всех.
    if (!isAdmin && userId) {
      query = query.eq('assigned_manager_id', userId)
    }

    query = query
      .order('days_since_last_order', { ascending: false }).limit(pageSize)

    const { data, count } = await query
    const fetched = (data as QueueClient[]) ?? []
    setClients(fetched)
    setTotalCount(count ?? 0)
    setLoading(false)

    // Автовыбор первого клиента если никто не выбран (ref чтобы не сбрасывать при refresh)
    if (!activeClientRef.current && fetched.length > 0) {
      const first = fetched.find((c) => !calledToday(c.last_called_at)) ?? fetched[0]
      handleSelectClient(first)
    }
  }, [preset.min, preset.max, userId, isAdmin, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (userId !== null) {
      fetchQueue()
      fetchStats()
      fetchCallbacks()
    }
  }, [userId, fetchQueue, fetchStats, fetchCallbacks])

  useEffect(() => {
    if (userId !== null) {
      intervalRef.current = setInterval(() => { fetchQueue(); fetchStats() }, REFRESH_INTERVAL)
      return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
    }
  }, [userId, fetchQueue, fetchStats])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('queue-locks')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients', filter: 'locked_by=neq.SKIP' }, () => fetchQueue())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (!activeClient || callPhase !== 'level1') return
      if (e.key === 'Escape') { e.preventDefault(); handleCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeClient, callPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load client context on select
  useEffect(() => {
    if (activeClient) {
      getClientCallHistory(activeClient.id).then(setCallHistory)
      getAttemptCount(activeClient.id).then(setAttemptCount)
    } else {
      setCallHistory([])
      setAttemptCount(0)
    }
  }, [activeClient])

  const maybeStopRecording = async () => {
    if (callTranscriptRef.current && calling) {
      try {
        await callTranscriptRef.current.stopRecording()
      } catch (err) {
        console.error('Ошибка при автоматической остановке записи:', err)
      }
    }
  }

  const handleSelectClient = (client: QueueClient) => {
    setActiveClient(client); activeClientRef.current = client
    setCallPhase('level1')
    setScoreResult(null); setScoring(false)
    setCalling(false)
  }

  const handleCancel = async () => {
    await maybeStopRecording()
    resetCallState()
  }

  const resetCallState = () => {
    setActiveClient(null); activeClientRef.current = null
    setCallPhase('level1')
    setCbDate(''); setCbTime(''); setCbNotes('')
    setDeclineReason(''); setDeclineText('')
    setScoreResult(null); setScoring(false)
    setCalling(false)
  }

  // Звонок SIP + Запуск записи
  const handleInitiateSipCall = async () => {
    if (!activeClient) return
    setCalling(true)
    toast.info('Инициируем SIP-звонок...')

    const res = await makeSipCall(activeClient.phone)
    if (res.success) {
      toast.success('Звонок успешно инициирован. АТС вызывает ваш телефон.')
      // Автоматически запускаем запись микрофона
      if (callTranscriptRef.current) {
        try {
          await callTranscriptRef.current.startRecording()
        } catch (err) {
          console.error('Ошибка автоматического старта записи:', err)
          toast.error('Не удалось автоматически включить запись микрофона. Запустите ее вручную.')
        }
      }
    } else {
      toast.error(res.error)
      setCalling(false)
    }
  }

  const handleTranscriptReady = async (fullText: string, durationSec: number) => {
    if (!activeClient || !fullText.trim()) return
    setScoring(true)
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: fullText,
          segment: activeClient.rfm_segment,
          totalOrders: activeClient.total_orders,
          daysSinceLastOrder: activeClient.days_since_last_order,
          clientName: activeClient.name,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        setScoreResult(result)
        // Сохраняем транскрипт
        await saveCallTranscript(activeClient.id, fullText, result.summary, result.score, durationSec)
      }
    } catch { /* ignore scoring errors */ }
    setScoring(false)
    setCalling(false)
  }

  const submitDisposition = async (input: DispositionInput) => {
    setDisposing(true)
    const res = await recordDisposition(input)
    if (!res.success) { toast.error(res.error); setDisposing(false); return }
    await fetchStats()
    setDisposing(false)
    return true
  }

  // Действие: заказ
  const handleOrder = async () => {
    if (!activeClient) return
    await maybeStopRecording()
    await submitDisposition({ clientId: activeClient.id, status: 'reached', subStatus: 'ordered' })
    setCallPhase('order')
  }

  // Действие: перезвонить (показать форму)
  const handleShowCallback = async () => {
    await maybeStopRecording()
    setCallPhase('callback_schedule')
  }

  // Действие: подтвердить перезвон
  const handleSubmitCallback = async () => {
    if (!activeClient || !cbDate) return
    await submitDisposition({
      clientId: activeClient.id, status: 'callback', subStatus: 'callback_later',
      nextCallDate: cbDate, nextCallTime: cbTime || undefined, notes: cbNotes || undefined,
    })
    toast.success(`Перезвон на ${cbDate}${cbTime ? ' ' + cbTime : ''}`)
    await handleNextClient()
  }

  // Действие: показать отказ (выбор причины)
  const handleShowDecline = async () => {
    await maybeStopRecording()
    setCallPhase('decline_reason')
  }

  // Действие: подтвердить отказ
  const handleSubmitDecline = async () => {
    if (!activeClient || !declineReason) return
    await submitDisposition({
      clientId: activeClient.id, status: 'declined',
      subStatus: declineReason as CallSubStatus,
      reason: declineReason === 'decline_other' ? declineText : undefined,
    })
    toast.success('Отказ сохранён')
    await handleNextClient()
  }

  // Действие: неверный номер
  const handleWrongNumber = async () => {
    if (!activeClient) return
    await maybeStopRecording()
    await submitDisposition({ clientId: activeClient.id, status: 'not_relevant', subStatus: 'wrong_number' })
    toast.success('Неверный номер — клиент архивирован')
    await handleNextClient()
  }

  // Действие: WhatsApp
  const handleWhatsApp = async () => {
    if (!activeClient) return
    await maybeStopRecording()
    await submitDisposition({ clientId: activeClient.id, status: 'reached', subStatus: 'sent_whatsapp' })
    setCallPhase('whatsapp')
  }

  // Действие: недоступен (авто-перезвон через 4 часа)
  const handleUnavailable = async () => {
    if (!activeClient) return
    await maybeStopRecording()
    const fourHoursLater = new Date(Date.now() + 4 * 60 * 60 * 1000)
    const date = `${fourHoursLater.getFullYear()}-${String(fourHoursLater.getMonth() + 1).padStart(2, '0')}-${String(fourHoursLater.getDate()).padStart(2, '0')}`
    const time = `${String(fourHoursLater.getHours()).padStart(2, '0')}:${String(fourHoursLater.getMinutes()).padStart(2, '0')}`
    await submitDisposition({
      clientId: activeClient.id, status: 'not_reached', subStatus: 'unavailable',
      nextCallDate: date, nextCallTime: time,
    })
    toast.success('Перезвон через 4 часа')
    await handleNextClient()
  }

  // Действие: заблокировал
  const handleBlocked = async () => {
    if (!activeClient) return
    await maybeStopRecording()
    await submitDisposition({ clientId: activeClient.id, status: 'not_reached', subStatus: 'blocked' })
    toast.success('Отмечено: заблокировал')
    await handleNextClient()
  }

  // Действие: WhatsApp из "не дозвонился"
  const handleNotReachedWhatsApp = async () => {
    if (!activeClient) return
    await maybeStopRecording()
    await submitDisposition({ clientId: activeClient.id, status: 'not_reached', subStatus: 'sent_whatsapp' })
    setCallPhase('whatsapp')
  }

  const handleNextClient = async () => {
    resetCallState()
    await fetchQueue(); await fetchCallbacks()
  }

  const visibleClients = showCalledToday ? clients : clients.filter((c) => !calledToday(c.last_called_at))
  
  // Скрипт для текущего клиента
  const script = activeClient
    ? renderScript(
        scriptTemplates[activeClient.rfm_segment] ?? scriptTemplates['Новый'] ?? '',
        activeClient.name,
        activeClient.days_since_last_order,
        discounts[SEGMENT_DISCOUNT_KEY[activeClient.rfm_segment] ?? 'new'] ?? 5
      )
    : ''

  return (
    <div className="flex gap-6">
      {/* ─── Левая часть ─── */}
      <div className={activeClient ? 'flex-1 min-w-0' : 'w-full'}>
        {/* Заголовок + компактный «План дня» одной строкой */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold">Очередь звонков</h1>
          <div className="flex items-center gap-4 rounded-xl border bg-card px-4 py-2 text-sm shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Звонки</span>
              <span className={stats.calls >= stats.dayTargetCalls ? 'font-semibold text-emerald-600' : 'font-semibold'}>{stats.calls}</span>
              <span className="text-muted-foreground">/{stats.dayTargetCalls}</span>
              <span className="inline-block h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                <span className="block h-full bg-blue-500 transition-all" style={{ width: `${Math.min(stats.calls / stats.dayTargetCalls * 100, 100)}%` }} />
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Заказы</span>
              <span className={stats.orders >= stats.planOrdersPerDay ? 'font-semibold text-emerald-600' : 'font-semibold'}>{stats.orders}</span>
              <span className="text-muted-foreground">/{stats.planOrdersPerDay}</span>
              <span className="inline-block h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                <span className="block h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(stats.orders / stats.planOrdersPerDay * 100, 100)}%` }} />
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Выручка</span>
              <span className="font-semibold">{(stats.revenue / 1000).toFixed(0)}К</span>
              <span className="text-muted-foreground">/{(stats.planRevenuePerDay / 1000).toFixed(0)}К ₸</span>
            </div>
            {stats.calls > 0 && stats.orders > 0 && (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100">
                Конв. {Math.round(stats.orders / stats.calls * 100)}%
              </Badge>
            )}
          </div>
        </div>

        {/* Перезвоны сегодня */}
        {callbacks.length > 0 && (
          <div className="mb-4 p-3 border rounded-lg border-orange-200 bg-orange-50">
            <div className="text-sm font-medium mb-2">Перезвоны сегодня ({callbacks.length})</div>
            <div className="space-y-1">
              {callbacks.map((cb) => (
                <div key={cb.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{cb.clientName}</span>
                    <span className="text-muted-foreground ml-2">{cb.clientPhone}</span>
                    {cb.time && <span className="text-orange-600 ml-2">{cb.time.slice(0, 5)}</span>}
                    {cb.notes && <span className="text-muted-foreground ml-2 text-xs">— {cb.notes}</span>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleSelectClient({ id: cb.clientId, name: cb.clientName, phone: cb.clientPhone } as QueueClient)}>
                    Выбрать
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Пресеты фильтров */}
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          {FILTER_PRESETS.map((p, i) => (
            <button key={p.label} onClick={() => { setActivePreset(i); setPageSize(50); setSelectedIds([]) }}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${activePreset === i ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-muted'}`}>
              {p.label}
            </button>
          ))}
          <label className="ml-3 flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={showCalledToday} onChange={(e) => setShowCalledToday(e.target.checked)} className="rounded" />
            Показать позвоненных
          </label>
        </div>

        {/* Массовые действия (плавающая панель) */}
        {isAdmin && selectedIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 p-3 px-6 rounded-2xl border border-blue-100 bg-white/95 backdrop-blur-md shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            <span className="font-semibold text-blue-800 text-sm whitespace-nowrap">Выбрано: {selectedIds.length}</span>
            
            <div className="flex items-center gap-2">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs cursor-pointer focus:outline-none"
                defaultValue=""
                disabled={bulkAssigning}
                onChange={async (e) => {
                  const val = e.target.value
                  if (!val) return
                  setBulkAssigning(true)
                  const managerId = val === 'unassigned' ? null : val
                  const res = await bulkAssignManager(selectedIds, managerId)
                  if (res.success) {
                    toast.success('Ответственный успешно назначен')
                    setSelectedIds([])
                    fetchQueue()
                  } else {
                    toast.error(res.error)
                  }
                  setBulkAssigning(false)
                  e.target.value = ''
                }}
              >
                <option value="" disabled>Назначить менеджера...</option>
                <option value="unassigned">Общая очередь</option>
                {Array.from(managersMap.entries()).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>

              <select
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs cursor-pointer focus:outline-none"
                defaultValue=""
                disabled={bulkAssigning}
                onChange={async (e) => {
                  const val = e.target.value
                  if (!val) return
                  setBulkAssigning(true)
                  const res = await bulkAssignSegment(selectedIds, val)
                  if (res.success) {
                    toast.success('Сегмент успешно изменен')
                    setSelectedIds([])
                    fetchQueue()
                  } else {
                    toast.error(res.error)
                  }
                  setBulkAssigning(false)
                  e.target.value = ''
                }}
              >
                <option value="" disabled>Изменить сегмент...</option>
                {['Новый', 'Повторный', 'Постоянный', 'В риске', 'Потерянный'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground hover:bg-muted/50"
              onClick={() => setSelectedIds([])}
              disabled={bulkAssigning}
            >
              Сбросить
            </Button>
          </div>
        )}

        {/* Таблица */}
        <div className="border border-[#ebe9e4] rounded-xl overflow-hidden bg-white shadow-xs">
          <Table>
            <TableHeader className="bg-[#fcfcfb]">
              <TableRow className="border-[#ebe9e4]">
                <TableHead className="w-12 text-center">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 accent-primary cursor-pointer h-4 w-4 align-middle"
                    checked={visibleClients.length > 0 && selectedIds.length === visibleClients.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(visibleClients.map((c) => c.id))
                      } else {
                        setSelectedIds([])
                      }
                    }}
                  />
                </TableHead>
                <TableHead>Имя</TableHead><TableHead>Телефон</TableHead><TableHead>Сегмент</TableHead>
                <TableHead>Посл. заказ</TableHead><TableHead>Адрес</TableHead>
                <TableHead className="text-right">Дней</TableHead><TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Загрузка...</TableCell></TableRow>
              ) : visibleClients.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Нет клиентов в очереди</TableCell></TableRow>
              ) : visibleClients.map((c, idx) => {
                const was = calledToday(c.last_called_at)
                const isNext = idx === 0 && !was && activeClient?.id !== c.id
                return (
                  <TableRow key={c.id} className={`transition-colors ${activeClient?.id === c.id ? 'bg-blue-50/50' : isNext ? 'bg-blue-50/20 border-l-2 border-l-blue-500' : selectedIds.includes(c.id) ? 'bg-blue-50/20' : ''} ${was ? 'opacity-50' : ''} border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30`}>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 accent-primary cursor-pointer h-4 w-4 align-middle"
                        checked={selectedIds.includes(c.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds((prev) => [...prev, c.id])
                          } else {
                            setSelectedIds((prev) => prev.filter((id) => id !== c.id))
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">{c.name}</TableCell>
                    <TableCell><a href={`tel:${c.phone}`} className="hover:underline text-muted-foreground" onClick={(e) => e.stopPropagation()}>{c.phone}</a></TableCell>
                    <TableCell><Badge variant="outline" className={SEGMENT_COLORS[c.rfm_segment] ?? ''}>{c.rfm_segment}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{c.last_order_date ? formatDate(c.last_order_date) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">{c.address ?? '—'}</TableCell>
                    <TableCell className="text-right">{c.days_since_last_order ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={was || !isNext ? 'outline' : 'default'} onClick={() => handleSelectClient(c)}>
                        Выбрать
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-muted-foreground">Показано {visibleClients.length} из {totalCount}</p>
          {clients.length < totalCount && (
            <Button size="sm" variant="outline" onClick={() => setPageSize((s) => s + 50)}>Загрузить ещё</Button>
          )}
        </div>
      </div>

      {/* ─── Правая панель ─── */}
      {activeClient && (
        <div className="w-96 shrink-0 animate-in slide-in-from-right duration-250">
          <div className="sticky top-6 rounded-xl border border-[#ebe9e4] bg-white shadow-md p-4 space-y-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
            {/* Инфо клиента */}
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-lg text-foreground leading-tight">{activeClient.name}</div>
                <a href={`tel:${activeClient.phone}`} className="text-sm text-muted-foreground hover:underline">{activeClient.phone}</a>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={SEGMENT_COLORS[activeClient.rfm_segment] ?? ''}>{activeClient.rfm_segment}</Badge>
                  {activeClient.days_since_last_order != null && (
                    <span className="text-xs text-muted-foreground">{activeClient.days_since_last_order} дн. без заказа</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {activeClient.total_orders} заказов &middot; {(activeClient.total_spent ?? 0).toLocaleString('ru-RU')} ₸
                  {attemptCount > 0 && <span className="text-orange-600 font-semibold ml-2">Попытка {attemptCount}/3</span>}
                </div>
              </div>
              <button onClick={() => setActiveClient(null)} className="text-[#a8a49a] hover:text-foreground">✕</button>
            </div>

            {/* Действия со SIP телефонией и Wazzup */}
            <div className="flex gap-2">
              <Button onClick={handleInitiateSipCall} className="flex-1 bg-[#2563eb] hover:bg-blue-700 flex items-center justify-center gap-1.5" disabled={calling}>
                <Phone className="w-4 h-4" /> Позвонить
              </Button>
              <Button onClick={() => setShowWazzupModal(true)} variant="outline" className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex items-center justify-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-emerald-700" /> Написать
              </Button>
            </div>



            {/* История звонков */}
            {callHistory.length > 0 && (
              <div className="border-t pt-3">
                <button onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <span>История звонков ({callHistory.length})</span>
                  <span>{showHistory ? '▾' : '▸'}</span>
                </button>
                <div className={`space-y-1 mt-2 ${showHistory ? '' : 'hidden'}`}>
                  {callHistory.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs">
                      <span className={h.status === 'reached' ? 'text-green-600' : h.status === 'declined' ? 'text-red-600' : 'text-muted-foreground'}>
                        {STATUS_LABELS[h.sub_status ?? ''] ?? STATUS_LABELS[h.status] ?? h.status}
                        {h.reason && <span className="text-muted-foreground"> — {h.reason}</span>}
                      </span>
                      <span className="text-muted-foreground">{formatTime(h.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Запись звонка */}
            <div className="border-t pt-3">
              <button onClick={() => setShowRecord((v) => !v)} className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground mb-2">
                <span>Запись и транскрипт</span>
                <span>{showRecord ? '▾' : '▸'}</span>
              </button>
              <div className={showRecord ? '' : 'hidden'}>
                <CallTranscript 
                  ref={callTranscriptRef}
                  onTranscriptReady={handleTranscriptReady} 
                />
              </div>
            </div>

            {/* AI оценка */}
            {(scoring || scoreResult) && (
              <div className="border-t pt-3">
                {scoreResult ? (
                  <ScoreDisplay result={scoreResult} onClose={() => setScoreResult(null)} />
                ) : (
                  <div className="text-center py-4 text-xs text-muted-foreground animate-pulse">Анализ звонка...</div>
                )}
              </div>
            )}

            <div className="mt-1 rounded-lg border bg-muted/40 p-3">
              {/* ─── Уровень 1: Все действия сразу ─── */}
              {callPhase === 'level1' && (
                <div className="space-y-4">
                  {/* Группа: Дозвонился */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-green-700">Дозвонился:</div>
                    <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={handleOrder} disabled={disposing}>
                      Оформить заказ
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleShowCallback} disabled={disposing}>
                      Перезвонить позже
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleShowDecline} disabled={disposing}>
                      Отказ (с причиной)
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleWhatsApp} disabled={disposing}>
                      Отправить WhatsApp
                    </Button>
                    <Button size="sm" variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50/50" onClick={handleWrongNumber} disabled={disposing}>
                      Неверный номер
                    </Button>
                  </div>

                  {/* Группа: Не дозвонился */}
                  <div className="space-y-2 border-t pt-3">
                    <div className="text-xs font-semibold text-red-700">Не дозвонился:</div>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleUnavailable} disabled={disposing}>
                      Недоступен (перезвон через 4ч)
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleBlocked} disabled={disposing}>
                      Сбросил / заблокировал
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleNotReachedWhatsApp} disabled={disposing}>
                      Отправить WhatsApp
                    </Button>
                  </div>

                  <div className="border-t pt-2">
                    <Button size="sm" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={handleCancel}>Пропустить</Button>
                  </div>
                </div>
              )}

              {/* ─── Выбор причины отказа ─── */}
              {callPhase === 'decline_reason' && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold">Причина отказа:</div>
                  <div className="space-y-1">
                    {DECLINE_REASONS.map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="radio" name="decline" value={r.value} checked={declineReason === r.value}
                          onChange={(e) => setDeclineReason(e.target.value)} className="accent-primary" />
                        {r.label}
                      </label>
                    ))}
                  </div>
                  {declineReason === 'decline_other' && (
                    <Input placeholder="Причина..." value={declineText} onChange={(e) => setDeclineText(e.target.value)} className="h-8 text-xs" />
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={handleSubmitDecline}
                      disabled={!declineReason || disposing}>
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCallPhase('level1'); setDeclineReason('') }}>← Назад</Button>
                  </div>
                </div>
              )}

              {/* ─── Назначение перезвона ─── */}
              {callPhase === 'callback_schedule' && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold">Когда перезвонить?</div>
                  <div className="flex gap-2">
                    <Input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} className="flex-1 h-8 text-xs" />
                    <Input type="time" value={cbTime} onChange={(e) => setCbTime(e.target.value)} className="w-24 h-8 text-xs" />
                  </div>
                  <Input placeholder="Заметка (необязательно)" value={cbNotes} onChange={(e) => setCbNotes(e.target.value)} className="h-8 text-xs" />
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={handleSubmitCallback} disabled={!cbDate || disposing}>
                      Запланировать
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCallPhase('level1')}>← Назад</Button>
                  </div>
                </div>
              )}

              {/* ─── Заказ ─── */}
              {callPhase === 'order' && (
                <OrderForm
                  clientId={activeClient.id} clientName={activeClient.name}
                  totalOrders={activeClient.total_orders}
                  onDone={handleNextClient} onCancel={handleCancel}
                />
              )}

              {/* ─── WhatsApp ─── */}
              {callPhase === 'whatsapp' && (
                <WhatsAppPanel clientId={activeClient.id} onDone={handleNextClient} onCancel={handleCancel} />
              )}
            </div>

            {/* Контекст клиента */}
            <div className="border-t pt-3 space-y-2">
              {activeClient.address && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Адрес: </span>
                  <span>{activeClient.address}</span>
                </div>
              )}
              {activeClient.last_order_date && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Посл. заказ: </span>
                  <span>{formatDate(activeClient.last_order_date)}</span>
                </div>
              )}
              {/* WA badge если уже писали */}
              {callHistory.some((h) => h.sub_status === 'sent_whatsapp') && (
                <Badge variant="outline" className="bg-green-50 text-green-700 text-[10px]">
                  WhatsApp уже отправлен
                </Badge>
              )}
              {/* Скидка для клиента */}
              <div className="text-xs">
                <span className="text-muted-foreground">Скидка: </span>
                <span className="font-medium">{discounts[SEGMENT_DISCOUNT_KEY[activeClient.rfm_segment] ?? 'new']}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модалка Wazzup чата */}
      {activeClient && (
        <WazzupChatModal
          isOpen={showWazzupModal}
          onClose={() => setShowWazzupModal(false)}
          clientPhone={activeClient.phone}
          clientName={activeClient.name}
        />
      )}
    </div>
  )
}
