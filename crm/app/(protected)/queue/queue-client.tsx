'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  getActiveClientDetails, getScheduledCallbacks, getDayStats as getDayStatsAction,
  type VpbxCallRow
} from './actions'
import type { Discounts, Scripts } from '../settings/actions'
import {
  bulkAssignManager, bulkAssignSegment, saveClientFilter, deleteSavedFilter,
  type FilterDictionaries, type SavedFilter,
} from '../clients/actions'
import { createTag } from '../clients/tag-actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { SEGMENT_COLORS, segmentNames, DEFAULT_SEGMENT_RULES, type SegmentConfig } from '@/lib/segments'
import { useUsersDirectory, useFilterDictionaries, useSegmentRules, useSettings, useSavedFilters } from '../_queries'
import { useAuth } from '../auth-context'
import { CallWorkPanel, type CallWorkClient, type CallWorkHistoryEntry } from '@/components/call-work-panel'
import { FilterBar } from '@/components/filter-bar'
import { CLIENT_FILTER_FIELDS, MANAGER_NONE } from '@/lib/filters/client-fields'
import { serializeConditions, parseConditions } from '@/lib/filters/url'
import type { FilterCondition } from '@/lib/filters/types'
import {
  fetchQueueList, queueListKey, parsePresetIndex, FILTER_PRESETS, PARAM_SEGMENT, PARAM_CALLED,
  type QueueClient,
} from './queue-query'

// ─── Constants ───

const REFRESH_INTERVAL = 30_000

// Дефолт дневной статистики до загрузки (стабильная ссылка — не дёргает ре-рендеры).
const DEFAULT_DAY_STATS: DayStats = {
  calls: 0, reached: 0, orders: 0, revenue: 0, whatsapp: 0,
  planRevenuePerDay: 0, planOrdersPerDay: 0, dayTargetCalls: 0, scope: 'personal',
}

// Стабильная пустая очередь (пока кэш не прогрет) — не плодит новые массивы на рендер.
const EMPTY_QUEUE: QueueClient[] = []

// Стабильные дефолты для справочников из shared-кэша (до первой загрузки).
const EMPTY_DICTIONARIES: FilterDictionaries = { tags: [], sources: [], services: [] }
const EMPTY_SAVED_FILTERS: SavedFilter[] = []
const DEFAULT_DISCOUNTS: Discounts = { new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 }
const EMPTY_SCRIPTS: Scripts = {}
const EMPTY_HISTORY: CallWorkHistoryEntry[] = []
const EMPTY_VPBX: VpbxCallRow[] = []

// Русское имя сегмента → ключ скидки. Зеркало SEGMENT_DISCOUNT_KEY в call-work-panel
// (там не экспортируется). Используется и для скидки футера, и для плейсхолдера {скидка}.
const SEGMENT_DISCOUNT_KEY: Record<string, keyof Discounts> = {
  'Новый': 'new', 'Повторный': 'repeat', 'Постоянный': 'regular',
  'В риске': 'at_risk', 'Потерянный': 'lost',
}

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

// ─── Types ─── (QueueClient вынесен в queue-query.ts — общий с SSR-префетчем)
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
  // Восстановление фильтров из URL при первом рендере (F5 сохраняет фильтры).
  const initialParamsRef = useRef(searchParams)
  const [activePreset, setActivePreset] = useState(() => parsePresetIndex(initialParamsRef.current.get(PARAM_SEGMENT)))
  // userId/isAdmin/hasSip — синхронно из layout (провалидировано на сервере), без client-side
  // getSession. Запрос списка стартует сразу при гидрации, не ждёт async-auth (экономит ~1с).
  const { userId, isAdmin, hasSip } = useAuth()
  const [activeClient, setActiveClient] = useState<QueueClient | null>(null)
  // callHistory / attemptCount / vpbxCalls теперь useQuery keyed by activeClient.id (см. ниже).
  // stats / statsLoaded / callbacks теперь приходят из TanStack Query (см. ниже,
  // после объявления viewManagerId — ключ статистики зависит от него).

  const [showCalledToday, setShowCalledToday] = useState(() => initialParamsRef.current.get(PARAM_CALLED) === '1')
  // Условия FilterBar: восстановление из ?f= на маунте, изменения пишутся в URL.
  const [conditions, setConditions] = useState<FilterCondition[]>(() =>
    parseConditions(initialParamsRef.current.get('f'))
  )
  const [pageSize, setPageSize] = useState(50)

  // ID текущего звонка из ?call= (переход из карточки) — передаётся в панель как initialCallId.
  const [pendingCallId, setPendingCallId] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeClientRef = useRef<QueueClient | null>(null)
  // Realtime-патч меняет данные очереди, но НЕ должен триггерить авто-выбор
  // (иначе закрытая панель переоткрывается на любое lock-событие коллег).
  const skipAutoSelectRef = useRef(false)

  const preset = FILTER_PRESETS[activePreset]

  // Массовое редактирование
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAssigning, setBulkAssigning] = useState(false)
  // Админ: какой менеджер сейчас просматривается (null = весь отдел). Опции — из managersMap (живой список).
  const [viewManagerId, setViewManagerId] = useState<string | null>(null)

  const queryClient = useQueryClient()

  // Общие справочники из shared-кэша (дедуп между /queue и /clients, мгновенно на возврате).
  const { managersMap, namesMap: userNames } = useUsersDirectory()
  const dictionaries = useFilterDictionaries().data ?? EMPTY_DICTIONARIES
  const segmentConfig = useSegmentRules().data ?? DEFAULT_SEGMENT_RULES
  const settings = useSettings().data
  const discounts = settings?.discounts ?? DEFAULT_DISCOUNTS
  const scripts = settings?.scripts ?? EMPTY_SCRIPTS
  const savedFiltersList = useSavedFilters('queue').data ?? EMPTY_SAVED_FILTERS

  // Детали активного клиента (история звонков, попытки, VPBX-записи) — keyed by id.
  // Один useQuery → один server action (getActiveClientDetails) вместо трёх. Server Actions
  // в Next.js сериализуются (router action queue), поэтому три отдельных экшена на каждый
  // выбор клиента = три раунд-трипа подряд. Объединено в один (три чтения параллельно на
  // сервере). Повторный выбор того же клиента = мгновенно из кэша; смена клиента = свой ключ.
  const activeClientId = activeClient?.id ?? null
  const { data: clientDetails } = useQuery({
    queryKey: ['client-details', activeClientId],
    queryFn: activeClientId ? () => getActiveClientDetails(activeClientId) : skipToken,
  })
  const callHistory = clientDetails?.history ?? EMPTY_HISTORY
  const attemptCount = clientDetails?.attemptCount ?? 0
  const vpbxCalls = clientDetails?.vpbxCalls ?? EMPTY_VPBX

  // Дневная статистика плана: кэш + дедуп. statsLoaded = данные уже пришли (гейтит цели).
  const { data: statsData } = useQuery({
    queryKey: ['queue-stats', viewManagerId],
    queryFn: () => getDayStatsAction(viewManagerId),
  })
  const stats = statsData ?? DEFAULT_DAY_STATS
  const statsLoaded = statsData !== undefined

  // Перезвоны на сегодня (общий список, без параметров).
  const { data: callbacksData } = useQuery({
    queryKey: ['queue-callbacks'],
    queryFn: () => getScheduledCallbacks(),
  })
  const callbacks = callbacksData ?? []

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
    void queryClient.invalidateQueries({ queryKey: ['saved-filters', 'queue'] })
    return true
  }

  const handleDeleteFilter = async (id: string) => {
    const res = await deleteSavedFilter(id)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['saved-filters', 'queue'] })
  }

  // Создание тега прямо из фильтра очереди.
  const handleCreateFilterOption = async (fieldKey: string, label: string) => {
    if (fieldKey !== 'tags') return null
    const res = await createTag(label)
    if (!res.success) {
      toast.error(res.error)
      return null
    }
    queryClient.setQueryData<FilterDictionaries>(['filter-dictionaries'], (old) =>
      old
        ? { ...old, tags: old.tags.some((t) => t.id === res.tag.id) ? old.tags : [...old.tags, res.tag] }
        : old,
    )
    return { value: res.tag.id, label: res.tag.name }
  }

  // Выбор клиента только переключает activeClient — детали (история/попытки/VPBX)
  // подтянут keyed-useQuery выше по activeClient.id.
  const handleSelectClient = (client: QueueClient, callId?: string | null) => {
    setActiveClient(client); activeClientRef.current = client
    setPendingCallId(callId ?? null)
  }

  const resetCallState = () => {
    setActiveClient(null); activeClientRef.current = null
    setPendingCallId(null)
  }

  // Очередь через TanStack Query. queryKey/queryFn — из общего модуля queue-query, тот же,
  // что и в серверном SSR-prefetch (page.tsx) → на первом рендере данные берутся из дегидрации,
  // список виден сразу, без клиентского раунд-трипа. placeholderData держит список при смене
  // пресета/пагинации (без скачка в «Загрузка»).
  const queueParams = { presetMin: preset.min, presetMax: preset.max, userId, isAdmin, pageSize, conditions, viewManagerId }
  const { data: queueData } = useQuery({
    queryKey: queueListKey(queueParams),
    queryFn: () => fetchQueueList(supabase, queueParams),
    placeholderData: (prev) => prev,
  })
  const clients = queueData?.clients ?? EMPTY_QUEUE
  const totalCount = queueData?.total ?? 0
  const loading = queueData === undefined

  // Автовыбор первого клиента — вынесен из queryFn (сайд-эффект нельзя в queryFn).
  // Тот же гард activeClientRef: после выбора не переселектит на realtime-патчах/рефетчах.
  useEffect(() => {
    // Realtime-патч очереди — авто-выбор пропускаем (флаг ставится в realtime-хендлере).
    const skip = skipAutoSelectRef.current
    skipAutoSelectRef.current = false
    if (skip) return
    if (activeClientRef.current) return
    const list = queueData?.clients
    if (!list || list.length === 0) return
    const first = list.find((c) => !calledToday(c.last_called_at) && !isForeignLock(c, userId))
    if (first) handleSelectClient(first)
  }, [queueData, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Поллинг только на видимой вкладке — фоновая вкладка не дёргает сервер.
  // При возврате на вкладку — мгновенный refresh (данные могли устареть).
  useEffect(() => {
    if (userId === null) return
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['queue-list'] })
    const refreshStats = () => queryClient.invalidateQueries({ queryKey: ['queue-stats'] })
    intervalRef.current = setInterval(() => {
      if (document.hidden) return
      refresh(); refreshStats()
    }, REFRESH_INTERVAL)
    const handleVisibilityChange = () => {
      if (!document.hidden) { refresh(); refreshStats() }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [userId, queryClient])

  // Realtime: точечное обновление лок-полей ОДНОЙ строки (дельта), НЕ полный refetch.
  // Best practice зрелых CRM: realtime отдаёт «что изменилось» → патчим конкретного
  // клиента в уже загруженном списке (мгновенный бейдж «Звонит X» / снятие лока), без
  // запроса к серверу. Полный refetch остаётся за поллингом (см. ~строку 419) — он ловит
  // структурные изменения (новые/ушедшие клиенты) и страхует, если realtime тихо отвалится.
  // Так нет ни шторма запросов, ни амплификации на всех менеджеров (старый колбэк звал
  // fetchQueue() на любой UPDATE clients → каждый апдейт = N запросов).
  useEffect(() => {
    const ch = supabase.channel('queue-locks')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients' }, (payload) => {
        const row = payload.new
        if (!row || typeof row.id !== 'string') return
        const id = row.id
        // Патчим лок-поля во ВСЕХ закэшированных вариантах списка (любой ключ ['queue-list', …]).
        let patched = false
        queryClient.setQueriesData<{ clients: QueueClient[]; total: number }>(
          { queryKey: ['queue-list'] },
          (old) => {
            if (!old) return old
            const idx = old.clients.findIndex((c) => c.id === id)
            if (idx === -1) return old // клиента нет в этом списке — игнорируем
            patched = true
            const next = old.clients.slice()
            next[idx] = {
              ...next[idx],
              locked_by: typeof row.locked_by === 'string' ? row.locked_by : null,
              locked_until: typeof row.locked_until === 'string' ? row.locked_until : null,
              last_called_at: typeof row.last_called_at === 'string' ? row.last_called_at : next[idx].last_called_at,
            }
            return { ...old, clients: next }
          },
        )
        // Авто-выбор пропускаем только если данные реально изменились (был ре-рендер).
        if (patched) skipAutoSelectRef.current = true
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [queryClient])

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
    await queryClient.invalidateQueries({ queryKey: ['queue-stats'] })
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
    void queryClient.invalidateQueries({ queryKey: ['queue-list'] })
    void queryClient.invalidateQueries({ queryKey: ['queue-callbacks'] })
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
                onChange={(e) => { setViewManagerId(e.target.value || null); setSelectedIds([]); setPageSize(50) }}
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
                    void queryClient.invalidateQueries({ queryKey: ['queue-list'] })
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
                    void queryClient.invalidateQueries({ queryKey: ['queue-list'] })
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
          onRefreshVpbx={() => activeClient && queryClient.invalidateQueries({ queryKey: ['client-details', activeClient.id] })}
          discounts={discounts}
          initialCallId={pendingCallId}
          scriptText={buildScriptText(activeClient, scripts, discounts)}
          clientMetaControlled
          clientTags={clientDetails?.tags}
          allClientTags={clientDetails?.allTags}
          clientAcquisition={clientDetails?.acquisition}
          onClientMetaChanged={() => activeClient && queryClient.invalidateQueries({ queryKey: ['client-details', activeClient.id] })}
        />
      )}
    </div>
  )
}

export function QueuePageClient() {
  return (
    <Suspense fallback={<div className="text-muted-foreground py-8 text-center">Загрузка...</div>}>
      <QueuePageInner />
    </Suspense>
  )
}
