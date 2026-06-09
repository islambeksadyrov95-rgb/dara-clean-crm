'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { createClient, getManagers, getClientCallHistoryWithNames, bulkAssignManager, bulkAssignSegment } from './actions'
import { lockClient, recordDisposition, saveCallTranscript, getAttemptCount, type CallStatus, type CallSubStatus } from '../queue/actions'
import { makeSipCall } from '@/lib/vpbx/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Phone, MessageSquare } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SEGMENT_COLORS } from '@/lib/segments'
import { WazzupChatModal } from '@/components/wazzup-chat-modal'
import { CallTranscript } from '../queue/call-transcript'
import { ScoreDisplay } from '../queue/score-display'

export const dynamic = 'force-dynamic'

const SEGMENTS = ['Все', 'Новый', 'Повторный', 'Постоянный', 'В риске', 'Потерянный'] as const
const PAGE_SIZE = 20
const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type Client = {
  id: string
  name: string
  phone: string
  address: string | null
  total_orders: number
  total_spent: number
  last_order_date: string | null
  rfm_segment: string
  days_since_last_order: number | null
  assigned_manager_id: string | null
}

type CallHistoryEntry = {
  id: string
  status: string
  sub_status: string | null
  reason: string | null
  notes: string | null
  created_at: string
  manager_name: string
}

const STATUS_LABELS: Record<string, string> = {
  reached: 'Дозвонился', not_reached: 'Не дозвонился',
  callback: 'Перезвонить', declined: 'Отказ', not_relevant: 'Не актуально',
  ordered: 'Заказ', callback_later: 'Перезвон', sent_whatsapp: 'WhatsApp',
  wrong_number: 'Неверный номер', unavailable: 'Недоступен', blocked: 'Заблокировал',
}

const DECLINE_REASONS = [
  { value: 'decline_expensive', label: 'Дорого' },
  { value: 'decline_competitor', label: 'Есть другая компания' },
  { value: 'decline_not_needed', label: 'Не нужно сейчас' },
  { value: 'decline_quality', label: 'Недоволен качеством' },
  { value: 'decline_season', label: 'Не сезон' },
  { value: 'decline_other', label: 'Другое' },
] as const

type CallPhase = 'level1' | 'reached_actions' | 'not_reached_actions' | 'decline_reason' | 'callback_schedule'

export default function ClientsPage() {
  const router = useRouter()
  const supabase = createSupabaseClient()

  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [segment, setSegment] = useState<string>('Все')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  
  // Менеджеры
  const [managersMap, setManagersMap] = useState<Map<string, string>>(new Map())
  
  // Роли и права
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  
  // Массовое редактирование
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAssigning, setBulkAssigning] = useState(false)
  
  // Создание клиента
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [newClientAddress, setNewClientAddress] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)

  // Выбранный клиент (правая панель)
  const [activeClient, setActiveClient] = useState<Client | null>(null)
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([])
  const [attemptCount, setAttemptCount] = useState(0)
  const [callPhase, setCallPhase] = useState<CallPhase>('level1')
  const [disposing, setDisposing] = useState(false)
  
  // Звонки
  const [calling, setCalling] = useState(false)
  const [callTranscriptRef, setCallTranscriptRef] = useState<any>(null)
  const [scoreResult, setScoreResult] = useState<any>(null)
  const [scoring, setScoring] = useState(false)
  
  // Перезвоны
  const [cbDate, setCbDate] = useState('')
  const [cbTime, setCbTime] = useState('')
  const [cbNotes, setCbNotes] = useState('')
  
  // Отказ
  const [declineReason, setDeclineReason] = useState('')
  const [declineText, setDeclineText] = useState('')

  // Wazzup
  const [showWazzupModal, setShowWazzupModal] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Получаем текущего пользователя и его роль
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id)
        setIsAdmin(user.user_metadata?.role === 'admin')
      }
    })
  }, [supabase])

  // Получаем список менеджеров
  useEffect(() => {
    async function loadManagers() {
      try {
        const list = await getManagers()
        const m = new Map<string, string>()
        if (Array.isArray(list)) {
          list.forEach((u) => m.set(u.id, u.name))
        }
        setManagersMap(m)
      } catch (err) {
        console.error('Failed to load managers:', err)
      }
    }
    loadManagers()
  }, [])

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // Сброс выбора при изменении страницы или фильтров
  useEffect(() => {
    Promise.resolve().then(() => {
      setSelectedIds([])
      setPage(0)
    })
  }, [debouncedSearch, segment])

  useEffect(() => {
    Promise.resolve().then(() => {
      setSelectedIds([])
    })
  }, [page])

  const fetchClients = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('client_segments')
      .select('*', { count: 'exact' })

    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`
      query = query.or(`name.ilike.${term},phone.ilike.${term}`)
    }

    if (segment !== 'Все') {
      query = query.eq('rfm_segment', segment)
    }

    query = query
      .order('last_order_date', { ascending: true, nullsFirst: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    const { data, count } = await query

    setClients((data as Client[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [debouncedSearch, segment, page]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchClients()
    })
  }, [fetchClients])

  const resetCallState = () => {
    setActiveClient(null)
    setCallPhase('level1')
    setScoreResult(null)
    setCalling(false)
    setCallHistory([])
    setAttemptCount(0)
  }

  const handleSelectClient = (client: Client) => {
    setActiveClient(client)
    setCallPhase('level1')
    setScoreResult(null)
    setCalling(false)
    getClientCallHistoryWithNames(client.id).then(setCallHistory)
    getAttemptCount(client.id).then(setAttemptCount)
  }

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClientName.trim() || !newClientPhone.trim()) {
      toast.error('Заполните Имя и Телефон')
      return
    }

    setCreatingClient(true)
    const res = await createClient(newClientName, newClientPhone, newClientAddress)
    if (res.success) {
      toast.success('Клиент успешно создан')
      setShowCreateModal(false)
      setNewClientName('')
      setNewClientPhone('')
      setNewClientAddress('')
      fetchClients()
    } else {
      toast.error(res.error)
    }
    setCreatingClient(false)
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
      if (callTranscriptRef) {
        try {
          await callTranscriptRef.startRecording()
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
        // Сохраняем транскрипт в базу
        await saveCallTranscript(activeClient.id, fullText, result.summary, result.score, durationSec)
      }
    } catch { /* ignore scoring errors */ }
    setScoring(false)
    setCalling(false)
  }

  const submitDisposition = async (status: CallStatus, subStatus?: CallSubStatus, notes?: string) => {
    if (!activeClient) return
    setDisposing(true)
    const res = await recordDisposition({
      clientId: activeClient.id,
      status,
      subStatus,
      notes,
      nextCallDate: cbDate || undefined,
      nextCallTime: cbTime || undefined,
      reason: declineReason === 'decline_other' ? declineText : declineReason || undefined,
    })
    
    if (res.success) {
      toast.success('Результат звонка зафиксирован')
      resetCallState()
      fetchClients()
    } else {
      toast.error(res.error)
    }
    setDisposing(false)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex gap-6">
      {/* Левая часть */}
      <div className={activeClient ? 'flex-1 min-w-0' : 'w-full'}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            + Создать клиента
          </Button>
        </div>

        {/* Фильтры */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <Input
            placeholder="Поиск по имени или телефону..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <div className="flex gap-1 flex-wrap">
            {SEGMENTS.map((s) => (
              <button
                key={s}
                onClick={() => setSegment(s)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  segment === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-muted'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
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
                    fetchClients()
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
                    fetchClients()
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
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin && (
                  <TableHead className="w-12 text-center">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 accent-primary cursor-pointer h-4 w-4 align-middle"
                      checked={clients.length > 0 && clients.every(c => selectedIds.includes(c.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(clients.map((c) => c.id))
                        } else {
                          setSelectedIds([])
                        }
                      }}
                    />
                  </TableHead>
                )}
                <TableHead>Имя</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Сегмент</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead className="text-right">Заказов</TableHead>
                <TableHead className="text-right">Потрачено</TableHead>
                <TableHead>Последний заказ</TableHead>
                <TableHead className="text-right">Дней</TableHead>
                <TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 10 : 9} className="text-center py-8 text-muted-foreground">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 10 : 9} className="text-center py-8 text-muted-foreground">
                    Клиенты не найдены
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((c) => (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                      activeClient?.id === c.id 
                        ? 'bg-blue-50/50' 
                        : selectedIds.includes(c.id) 
                          ? 'bg-blue-50/20' 
                          : ''
                    }`}
                    onClick={() => handleSelectClient(c)}
                  >
                    {isAdmin && (
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
                    )}
                    <TableCell className="font-semibold text-foreground">{c.name}</TableCell>
                    <TableCell>
                      <a href={`tel:${c.phone}`} className="hover:underline text-muted-foreground" onClick={(e) => e.stopPropagation()}>{c.phone}</a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SEGMENT_COLORS[c.rfm_segment] ?? ''}>
                        {c.rfm_segment}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-medium">
                      {c.assigned_manager_id ? (managersMap.get(c.assigned_manager_id) || 'Загрузка...') : 'Общая очередь'}
                    </TableCell>
                    <TableCell className="text-right">{c.total_orders}</TableCell>
                    <TableCell className="text-right">
                      {fmtMoney.format(c.total_spent)} ₸
                    </TableCell>
                    <TableCell>{formatDate(c.last_order_date)}</TableCell>
                    <TableCell className="text-right">
                      {c.days_since_last_order != null ? `${c.days_since_last_order} дн.` : '—'}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant={activeClient?.id === c.id ? 'default' : 'outline'}
                        onClick={() => handleSelectClient(c)}
                      >
                        Выбрать
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              {total} клиентов, стр. {page + 1} из {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 hover:bg-muted"
              >
                Назад
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 hover:bg-muted"
              >
                Вперёд
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Правая боковая панель */}
      {activeClient && (
        <div className="w-96 shrink-0 animate-in slide-in-from-right duration-250">
          <div className="sticky top-6 rounded-xl border border-[#ebe9e4] bg-white shadow-md p-4 space-y-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
            
            {/* Карточка с базовой информацией */}
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-lg text-foreground leading-tight">{activeClient.name}</div>
                <a href={`tel:${activeClient.phone}`} className="text-sm text-muted-foreground hover:underline">{activeClient.phone}</a>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={SEGMENT_COLORS[activeClient.rfm_segment] ?? ''}>{activeClient.rfm_segment}</Badge>
                  {attemptCount > 0 && <span className="text-xs text-orange-600 font-semibold">Попытка {attemptCount}/3</span>}
                </div>
              </div>
              <button onClick={resetCallState} className="text-[#a8a49a] hover:text-foreground">✕</button>
            </div>

            {/* Блок действий с телефонией и Wazzup */}
            <div className="flex gap-2">
              <Button onClick={handleInitiateSipCall} className="flex-1 bg-[#2563eb] hover:bg-blue-700 flex items-center justify-center gap-1.5" disabled={calling}>
                <Phone className="w-4 h-4" /> Позвонить
              </Button>
              <Button onClick={() => setShowWazzupModal(true)} variant="outline" className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex items-center justify-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-emerald-700" /> Написать
              </Button>
            </div>

            {/* Компонент аудиозаписи разговора */}
            <div className="border-t pt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2">Аудиозапись (микрофон)</div>
              <CallTranscript 
                ref={(instance) => setCallTranscriptRef(instance)} 
                onTranscriptReady={handleTranscriptReady} 
              />
            </div>

            {/* AI оценка и результат */}
            {(scoring || scoreResult) && (
              <div className="border-t pt-3">
                {scoreResult ? (
                  <ScoreDisplay result={scoreResult} onClose={() => setScoreResult(null)} />
                ) : (
                  <div className="text-center py-4 text-xs text-muted-foreground animate-pulse">Анализ разговора AI...</div>
                )}
              </div>
            )}

            {/* Диспетчер результатов звонка */}
            <div className="rounded-lg border bg-muted/40 p-3">
              {callPhase === 'level1' && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground font-medium">Результат звонка:</div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => setCallPhase('reached_actions')}>
                      Дозвонился
                    </Button>
                    <Button size="sm" variant="destructive" className="flex-1" onClick={() => setCallPhase('not_reached_actions')}>
                      Не дозвонился
                    </Button>
                  </div>
                </div>
              )}

              {callPhase === 'reached_actions' && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-green-700">Дозвонился:</div>
                  <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={() => submitDisposition('reached', 'ordered')} disabled={disposing}>
                    Оформил заказ
                  </Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setCallPhase('callback_schedule')} disabled={disposing}>
                    Перезвонить позже
                  </Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setCallPhase('decline_reason')} disabled={disposing}>
                    Отказ от услуг
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setCallPhase('level1')}>← Назад</Button>
                </div>
              )}

              {callPhase === 'not_reached_actions' && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-red-700">Не дозвонился:</div>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => submitDisposition('not_reached', 'unavailable')} disabled={disposing}>
                    Недоступен (перезвон)
                  </Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => submitDisposition('not_reached', 'blocked')} disabled={disposing}>
                    Сбросил / заблокировал
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setCallPhase('level1')}>← Назад</Button>
                </div>
              )}

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
                    <Input placeholder="Своя причина..." value={declineText} onChange={(e) => setDeclineText(e.target.value)} className="h-8 text-xs" />
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => submitDisposition('declined')} disabled={!declineReason || disposing}>
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCallPhase('reached_actions'); setDeclineReason('') }}>← Назад</Button>
                  </div>
                </div>
              )}

              {callPhase === 'callback_schedule' && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold">Назначить перезвон:</div>
                  <div className="flex gap-2">
                    <Input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} className="flex-1 h-8 text-xs" />
                    <Input type="time" value={cbTime} onChange={(e) => setCbTime(e.target.value)} className="w-24 h-8 text-xs" />
                  </div>
                  <Input placeholder="Заметка..." value={cbNotes} onChange={(e) => setCbNotes(e.target.value)} className="h-8 text-xs" />
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => submitDisposition('callback', 'callback_later')} disabled={!cbDate || disposing}>
                      Запланировать
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCallPhase('reached_actions')}>← Назад</Button>
                  </div>
                </div>
              )}
            </div>

            {/* История звонков */}
            {callHistory.length > 0 && (
              <div className="border-t pt-3">
                <div className="text-xs font-semibold text-muted-foreground mb-2">История звонков ({callHistory.length})</div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {callHistory.map((h) => (
                    <div key={h.id} className="text-[11px] border-b pb-1">
                      <div className="flex justify-between text-[#8a877e]">
                        <span>{formatTime(h.created_at)}</span>
                        <span className="font-medium text-foreground">{h.manager_name}</span>
                      </div>
                      <div className="font-semibold mt-0.5">
                        {STATUS_LABELS[h.sub_status ?? ''] || STATUS_LABELS[h.status] || h.status}
                        {h.reason && <span className="font-normal text-muted-foreground"> ({h.reason})</span>}
                      </div>
                      {h.notes && <div className="text-muted-foreground italic mt-0.5">«{h.notes}»</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
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
          clientId={activeClient.id}
          totalOrders={activeClient.total_orders}
        />
      )}

      {/* Модалка создания нового клиента */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white border border-[#ebe9e4] rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb] flex justify-between items-center">
              <h3 className="font-semibold text-sm">Создать нового клиента</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <form onSubmit={handleCreateClient} className="p-4 space-y-4">
              <div className="space-y-1">
                <label htmlFor="new-client-name" className="text-xs font-semibold text-muted-foreground">Имя клиента *</label>
                <Input
                  id="new-client-name"
                  required
                  placeholder="Например, Александр"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-client-phone" className="text-xs font-semibold text-muted-foreground">Телефон *</label>
                <Input
                  id="new-client-phone"
                  required
                  placeholder="Например, 87776217377"
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-client-address" className="text-xs font-semibold text-muted-foreground">Адрес (необязательно)</label>
                <Input
                  id="new-client-address"
                  placeholder="Улица, дом, квартира"
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreateModal(false)}>
                  Отмена
                </Button>
                <Button type="submit" size="sm" disabled={creatingClient}>
                  {creatingClient ? 'Создание...' : 'Создать клиента'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
