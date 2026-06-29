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
  phone: string | null
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
  has_trip: boolean | null // есть выезд (CRM order_trips); null = история (неизвестно)
  clients: ClientInfo | null
}

// orders_unified отдаёт клиента плоскими колонками client_name/client_phone — собираем clients в map.
type RawOrderRow = Omit<Order, 'clients'> & { client_name: string; client_phone: string | null }

export type OrdersListResult = { orders: Order[]; total: number }

// Итоги по текущему фильтру (весь набор, не только страница).
export type OrdersTotals = { orderCount: number; totalAmount: number; totalCarpets: number }

export type PaymentFilter = '' | 'debt' | 'paid'

export type OrdersQueryParams = {
  search: string
  service: string
  status: string // '' = все, иначе agbis_status_name
  manager: string // '' = все, иначе agbis_user_name (приёмщик)
  payment: PaymentFilter // '' все, 'debt' есть долг, 'paid' без долга
  dateFrom: string
  dateTo: string
  includeCancelled: boolean // false = скрыть «Отменённый» (как в Агбисе); true = показать
  dateType: OrderDateType // по какой дате фильтровать/сортировать (как «Дата» в Агбисе)
  page: number
}

const CANCELLED_STATUS = 'Отменённый'

// «Дата» как в Агбисе: приём / выдача / выезд → колонка orders_unified, по которой идут from/to и сортировка.
export type OrderDateType = 'intake' | 'delivery' | 'trip'
const DATE_TYPE_COLUMN: Record<OrderDateType, string> = {
  intake: 'order_date', // дата приёма
  delivery: 'agbis_date_out', // дата выдачи
  trip: 'trip_date', // дата выезда (забор)
}
function parseDateType(value: string | undefined): OrderDateType {
  return value === 'delivery' || value === 'trip' ? value : 'intake'
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
    includeCancelled: get('cancelled') === '1',
    dateType: parseDateType(get('dt')),
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
  if (p.includeCancelled) sp.set('cancelled', '1')
  if (p.dateType !== 'intake') sp.set('dt', p.dateType)
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
      includeCancelled: p.includeCancelled,
      dateType: p.dateType,
      page: p.page,
    },
  ] as const
}

// Ключ итогов — те же фильтры, что и список, но БЕЗ page: итоги считаются по всему набору фильтра,
// поэтому не должны рефетчиться при перелистывании страниц.
export function ordersTotalsKey(p: OrdersQueryParams) {
  return [
    'orders-totals',
    {
      search: p.search,
      service: p.service,
      status: p.status,
      manager: p.manager,
      payment: p.payment,
      dateFrom: p.dateFrom,
      dateTo: p.dateTo,
      includeCancelled: p.includeCancelled,
      dateType: p.dateType,
    },
  ] as const
}

export async function fetchOrdersList(
  supabase: SupabaseClient<Database>,
  params: OrdersQueryParams,
): Promise<OrdersListResult> {
  const { search, service, status, manager, payment, dateFrom, dateTo, includeCancelled, dateType, page } =
    params
  const dateCol = DATE_TYPE_COLUMN[dateType] // приём/выдача/выезд — по какой колонке фильтр и сортировка

  // Источник — VIEW orders_unified (CRM-заказы ∪ история, дедуп, RLS через security_invoker).
  // Клиент отдаётся плоскими колонками client_name/client_phone (у view нет FK для embed).
  let query = supabase
    .from('orders_unified')
    .select(
      `
      id,
      client_id,
      client_name,
      client_phone,
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
      has_trip
    `,
      { count: 'exact' }
    )

  // 1. Поиск по клиенту (имя или телефон) — прямо по колонкам view.
  if (search.trim()) {
    const term = `%${search.trim()}%`
    query = query.or(`client_name.ilike.${term},client_phone.ilike.${term}`)
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
  // 3a. По умолчанию прячем «Отменённый» (как в Агбисе) — показываем по галочке. Явный фильтр статуса
  // имеет приоритет (тогда не исключаем). is.null сохраняет строки без статуса (neq отбросил бы их).
  if (!status && !includeCancelled) {
    query = query.or(`agbis_status_name.is.null,agbis_status_name.neq.${CANCELLED_STATUS}`)
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
  // 6. Фильтр по датам — по выбранному типу даты (приём/выдача/выезд), календарная date YYYY-MM-DD.
  if (dateFrom) {
    query = query.gte(dateCol, dateFrom)
  }
  if (dateTo) {
    query = query.lte(dateCol, dateTo)
  }

  const { data, count, error } = await query
    .order(dateCol, { ascending: false, nullsFirst: false })
    .order('id', { ascending: false }) // детерминированный tiebreaker (даты не уникальны) — стабильная пагинация
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    .returns<RawOrderRow[]>()
  if (error) throw new Error(error.message)

  // Плоские client_name/client_phone → объект clients для UI (форма Order не меняется).
  const orders: Order[] = (data ?? []).map(({ client_name, client_phone, ...rest }) => ({
    ...rest,
    clients: { id: rest.client_id, name: client_name, phone: client_phone },
  }))
  return { orders, total: count ?? 0 }
}

// Итоги по текущему фильтру (весь набор, не только страница): кол-во заказов, Σ сумма, Σ ковров.
// Серверная агрегация через RPC fn_orders_list_totals (SECURITY INVOKER → та же RLS-видимость, что и
// список; агрегат в БД, не тянем весь набор в JS). Фильтры зеркалят fetchOrdersList; маппинг услуги в
// ILIKE-паттерн остаётся единым источником в JS (SERVICE_ILIKE) и передаётся параметром.
export async function fetchOrdersTotals(
  supabase: SupabaseClient<Database>,
  params: OrdersQueryParams,
): Promise<OrdersTotals> {
  const { search, service, status, manager, payment, dateFrom, dateTo, includeCancelled, dateType } =
    params
  const servicePattern = service !== 'Все' ? SERVICE_ILIKE[service] : undefined

  const { data, error } = await supabase.rpc('fn_orders_list_totals', {
    p_search: search.trim() || undefined,
    p_service_pattern: servicePattern || undefined,
    p_status: status || undefined,
    p_manager: manager || undefined,
    p_payment: payment || undefined,
    p_date_from: dateFrom || undefined,
    p_date_to: dateTo || undefined,
    p_include_cancelled: includeCancelled,
    p_date_type: dateType,
  })
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return {
    orderCount: row?.order_count ?? 0,
    totalAmount: row?.total_amount ?? 0,
    totalCarpets: row?.total_carpets ?? 0,
  }
}

// Застрявшие CRM-заказы: не ушли в Агбис (sync_status pending/failed) → курьеры их НЕ видят.
// Читаем напрямую из таблицы orders (а не из view orders_unified, где нет sync_status),
// RLS-scoped (менеджер — свои, admin — все). Для баннера-предупреждения на странице заказов.
export type StuckOrder = {
  id: string
  created_at: string
  amount: number | null
  sync_status: string | null
  sync_error: string | null
  client_name: string | null
}

export async function fetchStuckOrders(supabase: SupabaseClient<Database>): Promise<StuckOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, amount, sync_status, sync_error, clients(name)')
    .in('sync_status', ['pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const client = row.clients as { name?: string | null } | null
    return {
      id: row.id,
      created_at: row.created_at,
      amount: row.amount,
      sync_status: row.sync_status,
      sync_error: row.sync_error,
      client_name: client?.name ?? null,
    }
  })
}

// Список приёмщиков (distinct agbis_user_name) для опций фильтра. RLS-scoped: менеджер видит
// приёмщиков своих заказов, admin — всех. Дедуп в JS (один столбец, кэшируется на клиенте).
export async function fetchOrderManagers(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data, error } = await supabase.from('orders_unified').select('agbis_user_name')
  if (error) throw new Error(error.message)
  const set = new Set<string>()
  for (const row of data ?? []) {
    if (row.agbis_user_name) set.add(row.agbis_user_name)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
}
