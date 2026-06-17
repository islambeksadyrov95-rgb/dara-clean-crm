import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FilterCondition } from '@/lib/filters/types'
import {
  applyClientConditions, requiredEmbeds, broadcastNoOrderDays, EMPTY_RESULT_UUID,
} from '@/lib/filters/apply'

// Общая логика запроса очереди — используется и сервером (SSR-prefetch в page.tsx),
// и клиентом (useQuery в queue-client.tsx). Один источник правды + один queryKey →
// дегидрация на клиенте совпадает с серверным префетчем, список виден на первой отрисовке.

export const PARAM_SEGMENT = 'seg'
export const PARAM_CALLED = 'called'

export const FILTER_PRESETS = [
  { label: 'Все', min: 1, max: 9999 },
  { label: 'Повторные (30-60)', min: 30, max: 60 },
  { label: 'В риске (60-120)', min: 60, max: 120 },
  { label: 'Потерянные (120+)', min: 120, max: 9999 },
] as const

const QUEUE_COLUMNS =
  'id, name, phone, address, rfm_segment, days_since_last_order, total_orders, total_spent, last_order_date, last_called_at, locked_by, locked_until, assigned_manager_id'

export type QueueClient = {
  id: string; name: string; phone: string; address: string | null; rfm_segment: string
  days_since_last_order: number | null; total_orders: number; total_spent: number
  last_order_date: string | null; last_called_at: string | null
  locked_by: string | null; locked_until: string | null
  assigned_manager_id: string | null
  next_action_at?: string | null; sticky_note?: string | null
}

export type QueueQueryParams = {
  presetMin: number
  presetMax: number
  userId: string
  isAdmin: boolean
  pageSize: number
  conditions: FilterCondition[]
  viewManagerId: string | null
}

// Индекс пресета из URL (?seg=). Идентичная логика на сервере и клиенте.
export function parsePresetIndex(raw: string | null): number {
  const idx = raw != null ? Number(raw) : 0
  return Number.isInteger(idx) && idx >= 0 && idx < FILTER_PRESETS.length ? idx : 0
}

// Стабильный queryKey — ОДИН для серверного префетча и клиентского useQuery.
export function queueListKey(p: QueueQueryParams) {
  return [
    'queue-list',
    {
      presetMin: p.presetMin, presetMax: p.presetMax, userId: p.userId, isAdmin: p.isAdmin,
      pageSize: p.pageSize, conditions: p.conditions, viewManagerId: p.viewManagerId,
    },
  ] as const
}

export async function fetchQueueList(
  supabase: SupabaseClient<Database>,
  params: QueueQueryParams,
): Promise<{ clients: QueueClient[]; total: number }> {
  const { presetMin, presetMax, userId, isAdmin, pageSize, conditions, viewManagerId } = params

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
  const embeds = requiredEmbeds(conditions)
  const selectCols = embeds.length > 0 ? `${QUEUE_COLUMNS}, ${embeds.join(', ')}` : QUEUE_COLUMNS

  let query = supabase
    .from('client_segments')
    .select(selectCols, { count: 'exact' })
    .gte('days_since_last_order', presetMin).lte('days_since_last_order', presetMax)

  // Жёсткое распределение: менеджер видит только закреплённых; админ — всех или выбранного.
  if (!isAdmin && userId) {
    query = query.eq('assigned_manager_id', userId)
  } else if (isAdmin && viewManagerId) {
    query = query.eq('assigned_manager_id', viewManagerId)
  }

  if (broadcastIds) query = query.in('id', broadcastIds)
  applyClientConditions(query, conditions)

  const { data, count } = await query
    .order('days_since_last_order', { ascending: false })
    .limit(pageSize)
    .returns<QueueClient[]>()
  const base = data ?? []

  // next_action_at / sticky_note нет во view — прямой дозапрос из clients (не server action).
  const ids = base.map((c) => c.id)
  const { data: metaRows } = ids.length
    ? await supabase.from('clients').select('id, next_action_at, sticky_note').in('id', ids)
    : { data: [] as { id: string; next_action_at: string | null; sticky_note: string | null }[] }
  const metaById = new Map((metaRows ?? []).map((m) => [m.id, m]))

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
    if (aDue !== bDue) return bDue - aDue
    return (b.days_since_last_order ?? 0) - (a.days_since_last_order ?? 0)
  })

  return { clients: sorted, total: count ?? 0 }
}
