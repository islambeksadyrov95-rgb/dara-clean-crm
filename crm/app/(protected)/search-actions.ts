'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeSearchTerm } from '@/lib/search'
import {
  computeSegment,
  parseSegmentConfig,
  type SegmentConfig,
} from '@/lib/segments'

// Результат живого поиска клиента в шапке.
export type ClientSearchResult = {
  id: string
  name: string
  phone: string
  segment: string
}

const SEARCH_LIMIT = 10

// Колонки clients, нужные для отображения и расчёта сегмента (без select('*')).
const SEARCH_COLUMNS =
  'id, name, phone, total_orders, last_order_date, segment_override'

// Дни с последнего заказа (по календарным датам).
function daysSince(lastOrderDateStr: string | null): number | null {
  if (!lastOrderDateStr) return null
  const last = new Date(lastOrderDateStr)
  const today = new Date()
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const orderDate = new Date(last.getFullYear(), last.getMonth(), last.getDate())
  return Math.floor((todayDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))
}

async function loadSegmentConfig(
  admin: ReturnType<typeof createAdminClient>,
): Promise<SegmentConfig> {
  const { data } = await admin
    .from('crm_settings')
    .select('value')
    .eq('key', 'segment_rules')
    .maybeSingle()
  return parseSegmentConfig(data?.value)
}

// Живой поиск клиента по имени/телефону. Телефоны в E.164 (+7XXXXXXXXXX) — ilike
// по подстроке находит и по куску номера («7777»). Сегмент считаем на сервере,
// чтобы охватить и отказников (которых нет во view client_segments).
export async function searchClients(
  term: string,
): Promise<
  | { success: true; results: ClientSearchResult[] }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Не авторизован' }
    }

    const sanitized = sanitizeSearchTerm(term)
    if (!sanitized) {
      return { success: true as const, results: [] }
    }

    const pattern = `%${sanitized}%`
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('clients')
      .select(SEARCH_COLUMNS)
      .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(SEARCH_LIMIT)

    if (error || !data) {
      console.error('[search-actions] searchClients failed:', error?.message)
      return { success: false as const, error: 'Ошибка поиска' }
    }

    const config = await loadSegmentConfig(admin)

    const results: ClientSearchResult[] = data.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      segment:
        row.segment_override ??
        computeSegment(row.total_orders ?? 0, daysSince(row.last_order_date), config),
    }))

    return { success: true as const, results }
  } catch (err) {
    console.error('[search-actions] searchClients error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

// Almaty «сегодня» в формате YYYY-MM-DD (UTC+5, без DST).
function almatyTodayDate(): string {
  const now = new Date()
  const almatyOffset = 5 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const almatyNow = new Date(utcMs + almatyOffset * 60000)
  return `${almatyNow.getFullYear()}-${String(almatyNow.getMonth() + 1).padStart(2, '0')}-${String(almatyNow.getDate()).padStart(2, '0')}`
}

// Счётчик перезвонов на сегодня для бейджа в сайдбаре. Критерий совпадает с
// getScheduledCallbacks (queue/actions.ts): call_logs.status='callback',
// next_call_date = сегодня (Almaty), manager_id = текущий пользователь.
export async function getCallbackBadgeCount(): Promise<number> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return 0

    const today = almatyTodayDate()

    const { count, error } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'callback')
      .eq('next_call_date', today)
      .eq('manager_id', user.id)

    if (error) {
      console.error('[search-actions] getCallbackBadgeCount failed:', error.message)
      return 0
    }

    return count ?? 0
  } catch (err) {
    console.error('[search-actions] getCallbackBadgeCount error:', err)
    return 0
  }
}
