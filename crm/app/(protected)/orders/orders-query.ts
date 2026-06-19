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
//
// Состояние списка (фильтры + страница) живёт в URL (?q/&status/&manager/&payment/&from/&to/&page),
// чтобы возврат из карточки заказа /orders/[id] восстанавливал ту же страницу и фильтры. Сервер и
// клиент парсят URL одной и той же логикой (buildParams) → queryKey совпадает, гидрация не рвётся.

export const PAGE_SIZE = 100

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
  agbis_debet: number | null // оплачено (whole tenge)
  agbis_dolg: number | null // долг (whole tenge)
  agbis_user_name: string | null // приёмщик (Agbis employee)
  address: string | null
  clients: ClientInfo | null
}

// Supabase отдаёт embed clients как объект ИЛИ массив — нормализуем в map.
type RawOrderRow = Omit<Order, 'clients'> & { clients: ClientInfo | ClientInfo[] | null }

export type OrdersListResult = { orders: Order[]; total: number }

export type PaymentFilter = '' | 'debt' | 'paid'

export type OrdersQueryParams = {
  search: string
  service: string
  status: string // '' = все, иначе agbis_status_name
  manager: string // '' = все, иначе agbis_user_name (приёмщик)
  payment: PaymentFilter // '' все, 'debt' есть долг, 'paid' без долга
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

// Полный набор реальных статусов в данных (verified live 2026-06-19): Выданный/Отменённый/
// В исполнении/Исполненный/Новый. Используется как опции фильтра по статусу.
export const ORDER_STATUS_OPTIONS = [
  'Новый',
  'В исполнении',
  'Исполненный',
  'Выданный',
  'Отменённый',
] as const

// ── URL ↔ params (единый парсер для сервера и клиента) ──────────────────────
function buildParams(get: (key: string) => string | undefined): OrdersQueryParams {
  const pageRaw = Number.parseInt(get('page') ?? '', 10)
  const paymentRaw = get('payment')
  const payment: PaymentFilter = paymentRaw === 'debt' || paymentRaw === 'paid' ? paymentRaw : ''
  return {
    search: get('q') ?? '',
    service: get('service') || 'Все',
    status: get('status') ?? '',
    manager: get('manager') ?? '',
    payment,
    dateFrom: get('from') ?? '',
    dateTo: get('to') ?? '',
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 0,
  }
}

// Сервер: searchParams приходят как Record (Next App Router).
export function ordersParamsFromSearch(
  sp: Record<string, string | string[] | undefined>,
): OrdersQueryParams {
  return buildParams((key) => {
    const v = sp[key]
    return Array.isArray(v) ? v[0] : v
  })
}

// Клиент: useSearchParams() → URLSearchParams.
export function ordersParamsFromUrl(sp: URLSearchParams): OrdersQueryParams {
  return buildParams((key) => sp.get(key) ?? undefined)
}

// params → query-строка для router.replace (пишем только непустые значения).
export function ordersParamsToQuery(p: OrdersQueryParams): string {
  const sp = new URLSearchParams()
  if (p.search) sp.set('q', p.search)
  if (p.service && p.service !== 'Все') sp.set('service', p.service)
  if (p.status) sp.set('status', p.status)
  if (p.manager) sp.set('manager', p.manager)
  if (p.payment) sp.set('payment', p.payment)
  if (p.dateFrom) sp.set('from', p.dateFrom)
  if (p.dateTo) sp.set('to', p.dateTo)
  if (p.page > 0) sp.set('page', String(p.page))
  return sp.toString()
}

// Стабильный queryKey — ОДИН для серверного префетча и клиентского useQuery.
export function ordersListKey(p: OrdersQueryParams) {
  return [
    'orders-list',
    {
      search: p.search,
      service: p.service,
      status: p.status,
      manager: p.manager,
      payment: p.payment,
      dateFrom: p.dateFrom,
      dateTo: p.dateTo,
      page: p.page,
    },
  ] as const
}

export async function fetchOrdersList(
  supabase: SupabaseClient<Database>,
  params: OrdersQueryParams,
): Promise<OrdersListResult> {
  const { search, service, status, manager, payment, dateFrom, dateTo, page } = params

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
      agbis_debet,
      agbis_dolg,
      agbis_user_name,
      address,
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
  // 3. Фильтр по статусу (точное совпадение agbis_status_name).
  if (status) {
    query = query.eq('agbis_status_name', status)
  }
  // 4. Фильтр по приёмщику (agbis_user_name).
  if (manager) {
    query = query.eq('agbis_user_name', manager)
  }
  // 5. Фильтр по оплате: долг = agbis_dolg > 0; без долга = null или 0.
  if (payment === 'debt') {
    query = query.gt('agbis_dolg', 0)
  } else if (payment === 'paid') {
    query = query.or('agbis_dolg.is.null,agbis_dolg.eq.0')
  }
  // 6. Фильтр по датам — order_date это календарная date (YYYY-MM-DD), без времени/таймзоны.
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

// Список приёмщиков (distinct agbis_user_name) для опций фильтра. RLS-scoped: менеджер видит
// приёмщиков своих заказов, admin — всех. Дедуп в JS (один столбец, кэшируется на клиенте).
export async function fetchOrderManagers(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data, error } = await supabase.from('order_history').select('agbis_user_name')
  if (error) throw new Error(error.message)
  const set = new Set<string>()
  for (const row of data ?? []) {
    if (row.agbis_user_name) set.add(row.agbis_user_name)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
}
