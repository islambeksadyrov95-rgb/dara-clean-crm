import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Общая логика запроса списка заказов — используется и сервером (SSR-prefetch в page.tsx),
// и клиентом (useQuery в orders-client.tsx). Один источник правды + один queryKey →
// дегидрация на клиенте совпадает с серверным префетчем, список виден на первой отрисовке.
//
// Как /queue (а НЕ /clients): заказы читаются напрямую из таблицы request-scoped
// supabase-клиентом (RLS отдаёт свои заказы), без Server Action — поэтому сервер и клиент
// зовут одну функцию, передавая каждый свой supabase. Расходится только транспорт клиента,
// queryKey и форма результата едины.

export const PAGE_SIZE = 20

type ClientInfo = {
  id: string
  name: string
  phone: string
}

export type Order = {
  id: string
  client_id: string
  manager_id: string
  services: string[]
  amount: number
  discount_percent: number
  discount_amount: number
  comment: string | null
  created_at: string
  agbis_doc_num: string | null
  agbis_status_name: string | null
  delivery_date: string | null
  sync_status: string | null
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
    .from('orders')
    .select(
      `
      id,
      client_id,
      manager_id,
      services,
      amount,
      discount_percent,
      discount_amount,
      comment,
      created_at,
      agbis_doc_num,
      agbis_status_name,
      delivery_date,
      sync_status,
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
  // 2. Фильтр по услугам
  if (service !== 'Все') {
    query = query.contains('services', [service])
  }
  // 3. Фильтр по датам
  if (dateFrom) {
    query = query.gte('created_at', new Date(dateFrom).toISOString())
  }
  if (dateTo) {
    const endOfDay = new Date(dateTo)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('created_at', endOfDay.toISOString())
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
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
