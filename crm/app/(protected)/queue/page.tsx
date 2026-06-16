'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  getClientCallHistory, getAttemptCount, getScheduledCallbacks, getDayStats as getDayStatsAction,
  getClientVpbxCalls, getClientsActionMeta, type VpbxCallRow
} from './actions'
import { getSettings, type Discounts, type Scripts } from '../settings/actions'
import {
  getUsersDirectory, bulkAssignManager, bulkAssignSegment,
  getFilterDictionaries, listSavedFilters, saveClientFilter, deleteSavedFilter,
  type FilterDictionaries, type SavedFilter,
} from '../clients/actions'
import { createTag } from '../clients/tag-actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { SEGMENT_COLORS, segmentNames, DEFAULT_SEGMENT_RULES, type SegmentConfig } from '@/lib/segments'
import { getSegmentRules } from '../settings/actions'
import { getUserRole } from '@/lib/auth/get-user-role'
import { CallWorkPanel, type CallWorkClient, type CallWorkHistoryEntry } from '@/components/call-work-panel'
import { FilterBar } from '@/components/filter-bar'
import { CLIENT_FILTER_FIELDS, MANAGER_NONE } from '@/lib/filters/client-fields'
import { applyClientConditions, requiredEmbeds, broadcastNoOrderDays, EMPTY_RESULT_UUID } from '@/lib/filters/apply'
import { serializeConditions, parseConditions } from '@/lib/filters/url'
import type { FilterCondition } from '@/lib/filters/types'

// ─── Constants ───

const FILTER_PRESETS = [
  { label: 'Все', min: 1, max: 9999 },
  { label: 'Повторные (30-60)', min: 30, max: 60 },
  { label: 'В риске (60-120)', min: 60, max: 120 },
  { label: 'Потерянные (120+)', min: 120, max: 9999 },
] as const

const REFRESH_INTERVAL = 30_000

// Русское имя сегмента → ключ скидки. Зеркало SEGMENT_DISCOUNT_KEY в call-work-panel
// (там не экспортируется). Используется и для скидки футера, и для плейсхолдера {скидка}.
const SEGMENT_DISCOUNT_KEY: Record<string, keyof Discounts> = {
  'Новый': 'new', 'Повторный': 'repeat', 'Постоянный': 'regular',
  'В риске': 'at_risk', 'Потерянный': 'lost',
}

// Ключи фильтров в URL (память фильтров через searchParams).
const PARAM_SEGMENT = 'seg'
const PARAM_CALLED = 'called'

// Подставляет {имя}/{дней}/{скидка} в шаблон скрипта сегмента.
function fillScriptTemplate(template: string, name: string, days: number | null, discount: number): string {
  return template
    .replaceAll('{имя}', name)
    .replaceAll('{дней}', days != null ? String(days) : '—')
    .replaceAll('{скидка}', String(discount))
}

// Готовый текст скрипта для активного клиента: скрипт по сегменту + подстановки.
function buildScriptText(
  client: QueueClient | null,
  scripts: Scripts,
  discounts: Discounts,
): string | null {
  if (!client) return null
  const template = scripts[client.rfm_segment]
  if (!template || !template.trim()) return null
  const discount = discounts[SEGMENT_DISCOUNT_KEY[client.rfm_segment] ?? 'new']
  return fillScriptTemplate(template, client.name, client.days_since_last_order, discount)
}

// ─── Types ───
type QueueClient = {
  id: string; name: string; phone: string; address: string | null; rfm_segment: string
  days_since_last_order: number | null; total_orders: number; total_spent: number
  last_order_date: string | null; last_called_at: string | null
  locked_by: string | null; locked_until: string | null
  assigned_manager_id: string | null
  // Из дозапроса clients (во view client_segments этих колонок нет)
  next_action_at?: string | null; sticky_note?: string | null
}
type ScheduledCallback = { id: string; clientId: string; clientName: string; clientPhone: string; time: string | null; notes: string | null }
type DayStats = {
  calls: number
  reached: number
  orders: number
  revenue: number
  whatsapp: number
  planRevenuePerDay: number
  planOrdersPerDay: number
  dayTargetCalls: number
  scope: 'personal' | 'department'
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

// Чужой активный лок: занят НЕ текущим менеджером и срок ещё не истёк.
function isForeignLock(client: QueueClient, currentUserId: string | null): boolean {
  if (!client.locked_by || client.locked_by === currentUserId) return false
  if (!client.locked_until) return false
  return new Date(client.locked_until).getTime() > Date.now()
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

function QueuePageInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [clients, setClients] = useState<QueueClient[]>([])
  // Восстановление фильтров из URL при первом рендере (F5 сохраняет фильтры).
  const initialParamsRef = useRef(searchParams)
  const [activePreset, setActivePreset] = useState(() => {
    const raw = initialParamsRef.current.get(PARAM_SEGMENT)
    const idx = raw != null ? Number(raw) : 0
    return Number.isInteger(idx) && idx >= 0 && idx < FILTER_PRESETS.length ? idx : 0
  })
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeClient, setActiveClient] = useState<QueueClient | null>(null)
  const [callHistory, setCallHistory] = useState<CallWorkHistoryEntry[]>([])
  const [attemptCount, setAttemptCount] = useState(0)
  const [callbacks, setCallbacks] = useState<ScheduledCallback[]>([])
  
  // Цели грузятся с сервера (getDayStats). До загрузки числа не показываем —
  // иначе в шапке мелькают фейковые дефолты. statsLoaded гейтит отрисовку целей.
  const [stats, setStats] = useState<DayStats>({
    calls: 0, reached: 0, orders: 0, revenue: 0, whatsapp: 0,
    planRevenuePerDay: 0, planOrdersPerDay: 0, dayTargetCalls: 0, scope: 'personal'
  })
  const [statsLoaded, setStatsLoaded] = useState(false)

  // Имена ВСЕХ пользователей (включая админов) — для подписи владельца лока в очереди.
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map())
  
  const [discounts, setDiscounts] = useState<Discounts>({ new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 })
  const [scripts, setScripts] = useState<Scripts>({})
  const [showCalledToday, setShowCalledToday] = useState(() => initialParamsRef.current.get(PARAM_CALLED) === '1')
  // Условия FilterBar: восстановление из ?f= на маунте, изменения пишутся в URL.
  const [conditions, setConditions] = useState<FilterCondition[]>(() =>
    parseConditions(initialParamsRef.current.get('f'))
  )
  const [segmentConfig, setSegmentConfig] = useState<SegmentConfig>(DEFAULT_SEGMENT_RULES)
  const [dictionaries, setDictionaries] = useState<FilterDictionaries>({ tags: [], sources: [], services: [] })
  const [savedFiltersList, setSavedFiltersList] = useState<SavedFilter[]>([])
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)

  // VPBX-записи и AI-оценка текущего клиента (приходят с АТС после звонка).
  // Загружаются на странице (зависят от refresh), сама панель только рендерит.
  const [vpbxCalls, setVpbxCalls] = useState<VpbxCallRow[]>([])
  // ID текущего звонка из ?call= (переход из карточки) — передаётся в панель как initialCallId.
  const [pendingCallId, setPendingCallId] = useState<string | null>(null)

  // Телефония: есть ли у пользователя SIP-номер (гейтинг кнопки звонка в панели).
  const [hasSip, setHasSip] = useState(true) // optimistic: avoid flicker before user loads

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeClientRef = useRef<QueueClient | null>(null)

  const preset = FILTER_PRESETS[activePreset]

  // Массовое редактирование
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [managersMap, setManagersMap] = useState<Map<string, string>>(new Map())
  const [bulkAssigning, setBulkAssigning] = useState(false)
  // Админ: какой менеджер сейчас просматривается (null = весь отдел). Опции — из managersMap (живой список).
  const [viewManagerId, setViewManagerId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id)
        setIsAdmin(getUserRole(user) === 'admin')
        setHasSip(Boolean(user.user_metadata?.sip_extension || user.user_metadata?.sip_number))
      }
    })
    getSettings().then((s) => {
      setDiscounts(s.discounts)
      setScripts(s.scripts)
    })
    // Названия сегментов для опций фильтра «Сегмент» (настраиваются админом).
    getSegmentRules()
      .then(setSegmentConfig)
      .catch((err) => console.warn('Не удалось загрузить правила сегментации:', err))
    // Словари опций FilterBar + сохранённые фильтры очереди.
    getFilterDictionaries().then(setDictionaries)
    listSavedFilters('queue').then(setSavedFiltersList)
    // Менеджеры + имена пользователей одним server action (один listUsers вместо двух).
    async function loadUsers() {
      try {
        const { managers, allUsers } = await getUsersDirectory()
        setManagersMap(new Map(managers.map((u) => [u.id, u.name])))
        setUserNames(new Map(allUsers.map((u) => [u.id, u.name])))
      } catch (err) {
        console.error('Failed to load users directory:', err)
      }
    }
    loadUsers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConditionsChange = (next: FilterCondition[]) => {
    setConditions(next)
    setSelectedIds([])
    const params = new URLSearchParams(window.location.search)
    const serialized = serializeConditions(next)
    if (serialized) params.set('f', serialized)
    else params.delete('f')
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  // Поля фильтров с динамичными справочниками (менеджеры/админы, сегменты).
  const filterFields = CLIENT_FILTER_FIELDS.map((f) => {
    if (f.key === 'assigned_manager') {
      return {
        ...f,
        options: [
          { value: MANAGER_NONE, label: 'Общая очередь' },
          ...Array.from(userNames.entries()).map(([id, name]) => ({ value: id, label: name })),
        ],
      }
    }
    if (f.key === 'rfm_segment') {
      return { ...f, options: segmentNames(segmentConfig).map((s) => ({ value: s, label: s })) }
    }
    if (f.key === 'tags') {
      return { ...f, options: dictionaries.tags.map((t) => ({ value: t.id, label: t.name })) }
    }
    if (f.key === 'acquisition_source') {
      return {
        ...f,
        options: [
          { value: MANAGER_NONE, label: 'Не указан' },
          ...dictionaries.sources.map((s) => ({ value: s.id, label: s.name })),
        ],
      }
    }
    if (f.key === 'order_service') {
      return { ...f, options: dictionaries.services.map((s) => ({ value: s, label: s })) }
    }
    return f
  })

  const handleSaveFilter = async (name: string): Promise<boolean> => {
    const res = await saveClientFilter('queue', name, conditions)
    if (!res.success) {
      toast.error(res.error)
      return false
    }
    toast.success('Фильтр сохранён')
    setSavedFiltersList(await listSavedFilters('queue'))
    return true
  }

  const handleDeleteFilter = async (id: string) => {
    const res = await deleteSavedFilter(id)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    setSavedFiltersList((prev) => prev.filter((f) => f.id !== id))
  }

  // Создание тега прямо из фильтра очереди.
  const handleCreateFilterOption = async (fieldKey: string, label: string) => {
    if (fieldKey !== 'tags') return null
    const res = await createTag(label)
    if (!res.success) {
      toast.error(res.error)
      return null
    }
    setDictionaries((prev) => ({
      ...prev,
      tags: prev.tags.some((t) => t.id === res.tag.id) ? prev.tags : [...prev.tags, res.tag],
    }))
    return { value: res.tag.id, label: res.tag.name }
  }

  const loadVpbxCalls = useCallback(async (clientId: string) => {
    try {
      setVpbxCalls(await getClientVpbxCalls(clientId))
    } catch (err) {
      console.error('Не удалось загрузить записи VPBX:', err)
      setVpbxCalls([])
    }
  }, [])

  const handleSelectClient = (client: QueueClient, callId?: string | null) => {
    setActiveClient(client); activeClientRef.current = client
    setPendingCallId(callId ?? null)
    setVpbxCalls([])
    getClientCallHistory(client.id).then(setCallHistory)
    getAttemptCount(client.id).then(setAttemptCount)
    loadVpbxCalls(client.id)
  }

  const resetCallState = () => {
    setActiveClient(null); activeClientRef.current = null
    setPendingCallId(null)
    setVpbxCalls([])
    setCallHistory([])
    setAttemptCount(0)
  }

  const fetchStats = useCallback(async () => {
    const statsData = await getDayStatsAction(viewManagerId)
    setStats(statsData)
    setStatsLoaded(true)
  }, [viewManagerId])

  const fetchCallbacks = useCallback(async () => { setCallbacks(await getScheduledCallbacks()) }, [])

  const fetchQueue = useCallback(async () => {
    if (userId === null) return // Ждем загрузки userId

    // «Рассылка без заказа» — асинхронное условие: ids через RPC до основного запроса.
    const noOrderDays = broadcastNoOrderDays(conditions)
    let broadcastIds: string[] | null = null
    if (noOrderDays) {
      const { data: idRows, error: rpcError } = await supabase.rpc('broadcast_no_order_ids', { p_days: noOrderDays })
      if (rpcError) console.error('[queue] broadcast_no_order_ids:', rpcError.message)
      broadcastIds = rpcError ? [] : (idRows ?? []).map((r) => r.client_id).slice(0, 1000)
      if (broadcastIds.length === 0) broadcastIds = [EMPTY_RESULT_UUID]
    }

    // Кросс-сущностные условия требуют embed-строк в select.
    const QUEUE_COLUMNS = 'id, name, phone, address, rfm_segment, days_since_last_order, total_orders, total_spent, last_order_date, last_called_at, locked_by, locked_until, assigned_manager_id'
    const embeds = requiredEmbeds(conditions)
    const selectCols = embeds.length > 0 ? `${QUEUE_COLUMNS}, ${embeds.join(', ')}` : QUEUE_COLUMNS

    let query = supabase
      .from('client_segments')
      .select(selectCols, { count: 'exact' })
      .gte('days_since_last_order', preset.min).lte('days_since_last_order', preset.max)

    // Жесткое распределение: если менеджер — показываем только закрепленных за ним.
    // Админ видит всех.
    if (!isAdmin && userId) {
      query = query.eq('assigned_manager_id', userId)
    } else if (isAdmin && viewManagerId) {
      // Админ выбрал конкретного менеджера — показываем только закреплённых за ним.
      query = query.eq('assigned_manager_id', viewManagerId)
    }

    if (broadcastIds) query = query.in('id', broadcastIds)

    // Условия FilterBar (AND к пресету сегмента). View содержит все фильтруемые колонки.
    applyClientConditions(query, conditions)

    const { data, count } = await query
      .order('days_since_last_order', { ascending: false })
      .limit(pageSize)
      .returns<QueueClient[]>()
    const base = data ?? []

    // next_action_at / sticky_note нет во view — дозапрашиваем из clients и мёржим.
    const meta = await getClientsActionMeta(base.map((c) => c.id))
    const metaById = new Map(meta.map((m) => [m.id, m]))
    const nowMs = Date.now()
    const enriched = base.map((c) => {
      const m = metaById.get(c.id)
      return { ...c, next_action_at: m?.next_action_at ?? null, sticky_note: m?.sticky_note ?? null }
    })

    // Отложенные на будущее (snooze) скрываем; с наступившим сроком — поднимаем наверх.
    const visible = enriched.filter((c) => !c.next_action_at || new Date(c.next_action_at).getTime() <= nowMs)
    const sorted = visible.slice().sort((a, b) => {
      const aDue = a.next_action_at ? 1 : 0
      const bDue = b.next_action_at ? 1 : 0
      if (aDue !== bDue) return bDue - aDue // наступившие next_action_at — выше
      return (b.days_since_last_order ?? 0) - (a.days_since_last_order ?? 0)
    })

    setClients(sorted)
    setTotalCount(count ?? 0)
    setLoading(false)

    // Автовыбор первого клиента если никто не выбран (ref чтобы не сбрасывать при refresh).
    // Пропускаем уже позвоненных и занятых чужим локом.
    if (!activeClientRef.current && sorted.length > 0) {
      const first = sorted.find((c) => !calledToday(c.last_called_at) && !isForeignLock(c, userId))
      if (first) handleSelectClient(first)
    }
  }, [preset.min, preset.max, userId, isAdmin, pageSize, conditions, viewManagerId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (userId !== null) {
      Promise.resolve().then(() => {
        fetchQueue()
        fetchStats()
        fetchCallbacks()
      })
    }
  }, [userId, fetchQueue, fetchStats, fetchCallbacks])

  // Поллинг только на видимой вкладке — фоновая вкладка не дёргает сервер.
  // При возврате на вкладку — мгновенный refresh (данные могли устареть).
  useEffect(() => {
    if (userId === null) return
    intervalRef.current = setInterval(() => {
      if (document.hidden) return
      fetchQueue(); fetchStats()
    }, REFRESH_INTERVAL)
    const handleVisibilityChange = () => {
      if (!document.hidden) { fetchQueue(); fetchStats() }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [userId, fetchQueue, fetchStats])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('queue-locks')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients', filter: 'locked_by=neq.SKIP' }, () => fetchQueue())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Память фильтров: пресет сегмента + тоггл «показать обзвоненных» → URL searchParams.
  // shallow router.replace без скролла; F5 восстанавливает из searchParams (см. useState-инициализаторы).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (activePreset === 0) params.delete(PARAM_SEGMENT)
    else params.set(PARAM_SEGMENT, String(activePreset))
    if (showCalledToday) params.set(PARAM_CALLED, '1')
    else params.delete(PARAM_CALLED)
    const qs = params.toString()
    const target = qs ? `/queue?${qs}` : '/queue'
    // Гард от шторма: replace только если URL реально меняется (иначе каждый рендер
    // переписывал бы URL → RSC-рефетч → ре-рендер → бесконечный цикл запросов `queue`).
    const current = `${window.location.pathname}${window.location.search}`
    if (target !== current) router.replace(target, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset, showCalledToday])

  // Открыть конкретного клиента из ?client= (переход из карточки) и привязать ?call=
  useEffect(() => {
    const clientParam = searchParams.get('client')
    if (!clientParam || userId === null) return
    const callParam = searchParams.get('call')
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('client_segments')
        .select('id, name, phone, address, rfm_segment, days_since_last_order, total_orders, total_spent, last_order_date, last_called_at, locked_by, locked_until, assigned_manager_id')
        .eq('id', clientParam)
        .maybeSingle()
      if (cancelled) return
      if (data) {
        handleSelectClient(data as QueueClient, callParam)
      }
      // Снимаем только client/call, чтобы рефреш не переоткрывал клиента — фильтры в URL сохраняем.
      const params = new URLSearchParams(window.location.search)
      params.delete('client'); params.delete('call')
      const qs = params.toString()
      router.replace(qs ? `/queue?${qs}` : '/queue', { scroll: false })
    })()
    return () => { cancelled = true }
  }, [searchParams, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // После сохранённой диспозиции: обновляем дневную статистику (как делал submitDisposition),
  // очищаем панель и переходим к следующему клиенту.
  const handleDispositionDone = async () => {
    // Мгновенный переход к следующему; статистику дня обновляем в фоне.
    handleNextClient()
    await fetchStats()
  }

  const visibleClients = showCalledToday ? clients : clients.filter((c) => !calledToday(c.last_called_at))

  // Optimistic next: сразу выбираем следующего из УЖЕ загруженного списка (мгновенный переход),
  // а очередь/перезвоны обновляем в фоне. Пропускаем текущего, обзвоненных и чужие локи.
  const handleNextClient = () => {
    const current = activeClientRef.current
    const candidates = visibleClients.filter(
      (c) => c.id !== current?.id && !calledToday(c.last_called_at) && !isForeignLock(c, userId),
    )
    const next = candidates[0] ?? null
    if (next) handleSelectClient(next)
    else resetCallState()
    // Фоновое обновление списка/перезвонов — без блокировки перехода.
    fetchQueue()
    fetchCallbacks()
  }


  return (
    <div className="flex gap-6">
      {/* ─── Левая часть ─── */}
      <div className={activeClient ? 'flex-1 min-w-0' : 'w-full'}>
        {/* Заголовок + компактный «План дня» одной строкой */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold">Очередь звонков</h1>
          <div className="flex items-center gap-4 rounded-xl border bg-card px-4 py-2 text-sm shadow-sm">
            {isAdmin && (
              <select
                className="h-7 rounded-md border border-input bg-background px-2 text-xs cursor-pointer focus:outline-none"
                value={viewManagerId ?? ''}
                onChange={(e) => { setViewManagerId(e.target.value || null); setSelectedIds([]); setPageSize(50); setStatsLoaded(false); setLoading(true) }}
                title="Чей план дня показывать"
              >
                <option value="">Весь отдел</option>
                {Array.from(managersMap.entries()).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Звонки</span>
              {!statsLoaded ? (
                <span className="text-muted-foreground">{stats.calls}/…</span>
              ) : stats.dayTargetCalls >= 1 ? (
                <>
                  <span className={stats.calls >= stats.dayTargetCalls ? 'font-semibold text-emerald-600' : 'font-semibold'}>{stats.calls}</span>
                  <span className="text-muted-foreground">/{stats.dayTargetCalls}</span>
                  <span className="inline-block h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                    <span className="block h-full bg-blue-500 transition-all" style={{ width: `${Math.min(stats.calls / stats.dayTargetCalls * 100, 100)}%` }} />
                  </span>
                </>
              ) : (
                <span className="font-semibold">{stats.calls}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Заказы</span>
              {!statsLoaded ? (
                <span className="text-muted-foreground">{stats.orders}/…</span>
              ) : stats.planOrdersPerDay > 0 ? (
                <>
                  <span className={stats.orders >= stats.planOrdersPerDay ? 'font-semibold text-emerald-600' : 'font-semibold'}>{stats.orders}</span>
                  <span className="text-muted-foreground">/{stats.planOrdersPerDay}</span>
                  <span className="inline-block h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                    <span className="block h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(stats.orders / stats.planOrdersPerDay * 100, 100)}%` }} />
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold">{stats.orders}</span>
                  <span className="text-muted-foreground">/план не задан</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Выручка</span>
              <span className="font-semibold">{(stats.revenue / 1000).toFixed(0)}К</span>
              {!statsLoaded ? (
                <span className="text-muted-foreground">/…</span>
              ) : stats.planRevenuePerDay > 0 ? (
                <span className="text-muted-foreground">/{(stats.planRevenuePerDay / 1000).toFixed(0)}К ₸</span>
              ) : (
                <span className="text-muted-foreground">/план не задан</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">WhatsApp</span>
              <span className="font-semibold text-green-600">{stats.whatsapp}</span>
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

        {/* Конструктор фильтров: любое поле клиента, AND к пресету выше */}
        <FilterBar
          fields={filterFields}
          conditions={conditions}
          onChange={handleConditionsChange}
          savedFilters={savedFiltersList}
          onSaveCurrent={handleSaveFilter}
          onDeleteSaved={handleDeleteFilter}
          onCreateOption={handleCreateFilterOption}
        />

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
                const locked = isForeignLock(c, userId)
                const lockOwner = locked && c.locked_by ? (userNames.get(c.locked_by) ?? 'менеджером') : null
                const isNext = idx === 0 && !was && !locked && activeClient?.id !== c.id
                return (
                  <TableRow key={c.id} className={`transition-colors ${activeClient?.id === c.id ? 'bg-blue-50/50' : isNext ? 'bg-blue-50/20 border-l-2 border-l-blue-500' : selectedIds.includes(c.id) ? 'bg-blue-50/20' : ''} ${was || locked ? 'opacity-50' : ''} border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30`}>
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
                    <TableCell className="font-semibold text-foreground">
                      <span className="inline-flex items-center gap-2">
                        {c.name}
                        {lockOwner && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-100 text-[10px] font-normal">
                            Звонит {lockOwner}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell><a href={`tel:${c.phone}`} className="hover:underline text-muted-foreground" onClick={(e) => e.stopPropagation()}>{c.phone}</a></TableCell>
                    <TableCell><Badge variant="outline" className={SEGMENT_COLORS[c.rfm_segment] ?? ''}>{c.rfm_segment}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{c.last_order_date ? formatDate(c.last_order_date) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">{c.address ?? '—'}</TableCell>
                    <TableCell className="text-right">{c.days_since_last_order ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={was || !isNext ? 'outline' : 'default'} disabled={locked} onClick={() => handleSelectClient(c)}>
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

      {/* ─── Правая панель: общий компонент работы со звонком ─── */}
      {activeClient && (
        <CallWorkPanel
          key={activeClient.id}
          client={activeClient as CallWorkClient}
          callHistory={callHistory}
          attemptCount={attemptCount}
          onClose={resetCallState}
          onDispositionDone={handleDispositionDone}
          onNextClient={handleNextClient}
          fullDispositionFlow
          showNextClient
          hasSip={hasSip}
          vpbxCalls={vpbxCalls}
          onRefreshVpbx={() => activeClient && loadVpbxCalls(activeClient.id)}
          discounts={discounts}
          initialCallId={pendingCallId}
          scriptText={buildScriptText(activeClient, scripts, discounts)}
        />
      )}
    </div>
  )
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground py-8 text-center">Загрузка...</div>}>
      <QueuePageInner />
    </Suspense>
  )
}
