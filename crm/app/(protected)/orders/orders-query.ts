import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Общая логика запроса списка заказов — используется и сервером (SSR-prefetch в page.tsx),
// и клиентом (useQuery в orders-client.tsx). Один источник правды + один queryKey →
// дегидрация на клиенте совпадает с серверным префетчем, список виден на первой отрисовке.
//
// Источник данных — таблица order_history (исторический импорт из Агбиса, ~7k строк), а не
// живая orders. Читается напрямую request-scoped supabase-клиентом (RLS oh_select: admin видит
// всё, менеджер — заказы своих клиентов), без Server Action — поэтому сервер и клиент зовут одну
// функцию, передавая каждый свой supabase. Расходится только транспорт клиента, queryKey и форма
// результата едины.

export const PAGE_SIZE = 20

type ClientInfo = {
  id: string
  name: string
  phone: string
}

export type Order = {
  id: string
  client_id: string
  order_date: string
  amount: number
  agbis_status_name: string | null
  agbis_doc_num: string | null
  service: string | null
  agbis_date_out: string | null
  agbis_discount: number | null
  clients: ClientInfo | null
}

// Supabase отдаёт embed clients как объект ИЛИ массив — нормализуем в map.
type RawOrderRow = Omit<Order, 'clients'> & { clients: ClientInfo | ClientInfo[] | null }

export type OrdersListResult = { orders: Order[]; total: number }

export type OrdersQueryParams = {
  search: string
  service: string
  dateFrom: string
  dateTo: string
  page: number
}

// Маппинг чипов услуги → подстрока для ILIKE по order_history.service (это ТЕКСТ, одна строка,
// напр. "Ковер (Иранский, 6 м²)"). Best-effort, приблизительно: в данных пишут "Ковер".
const SERVICE_ILIKE: Record<string, string> = {
  Ковры: '%овер%',
  Шторы: '%штор%',
  Мебель: '%мебел%',
  Клининг: '%клининг%',
}

// Параметры первого рендера: страница /orders не читает фильтры из URL — клиент стартует
// с пустого поиска, услуги «Все», без дат, страница 0. Сервер обязан строить queryKey
// ровно из этих значений, иначе дегидрация не совпадёт с useQuery первого рендера.
export function ordersParamsFromSearch(
  _sp: Record<string, string | string[] | undefined>,
): OrdersQueryParams {
  return { search: '', service: 'Все', dateFrom: '', dateTo: '', page: 0 }
}

// Стабильный queryKey — ОДИН для серверного префетча и клиентского useQuery.
export function ordersListKey(p: OrdersQueryParams) {
  return [
    'orders-list',
    { search: p.search, service: p.service, dateFrom: p.dateFrom, dateTo: p.dateTo, page: p.page },
  ] as const
}

export async function fetchOrdersList(
  supabase: SupabaseClient<Database>,
  params: OrdersQueryParams,
): Promise<OrdersListResult> {
  const { search, service, dateFrom, dateTo, page } = params

  let query = supabase
    .from('order_history')
    .select(
      `
      id,
      client_id,
      order_date,
      amount,
      agbis_status_name,
      agbis_doc_num,
      service,
      agbis_date_out,
      agbis_discount,
      clients!inner (
        id,
        name,
        phone
      )
    `,
      { count: 'exact' }
    )

  // 1. Поиск по клиенту (имя или телефон)
  if (search.trim()) {
    const term = `%${search.trim()}%`
    query = query.or(`name.ilike.${term},phone.ilike.${term}`, { foreignTable: 'clients' })
  }
  // 2. Фильтр по услугам — service это ТЕКСТ, поэтому ILIKE по подстроке (best-effort).
  if (service !== 'Все') {
    const pattern = SERVICE_ILIKE[service]
    if (pattern) {
      query = query.ilike('service', pattern)
    }
  }
  // 3. Фильтр по датам — order_date это календарная date (YYYY-MM-DD), без времени/таймзоны.
  if (dateFrom) {
    query = query.gte('order_date', dateFrom)
  }
  if (dateTo) {
    query = query.lte('order_date', dateTo)
  }

  const { data, count, error } = await query
    .order('order_date', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    .returns<RawOrderRow[]>()
  if (error) throw new Error(error.message)

  // clients может прийти как объект или как массив — нормализуем.
  const orders = (data ?? []).map((o) => {
    const clientData = Array.isArray(o.clients) ? o.clients[0] : o.clients
    return { ...o, clients: clientData ?? null }
  })
  return { orders, total: count ?? 0 }
}
