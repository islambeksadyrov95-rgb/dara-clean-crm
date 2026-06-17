import type { FilterCondition } from '@/lib/filters/types'
import { parseConditions } from '@/lib/filters/url'
import { getClientsList } from './actions'

// Общая логика запроса списка клиентов — используется и сервером (SSR-prefetch в page.tsx),
// и клиентом (useQuery в clients-client.tsx). Один queryKey → дегидрация на клиенте совпадает
// с серверным префетчем, список виден на первой отрисовке без клиентского раунд-трипа.
//
// В отличие от /queue (запрос к view напрямую request-scoped клиентом) список клиентов
// читается через Server Action getClientsList: ему нужен admin-клиент (обход RLS для поиска
// по всей базе, включая отказников). Поэтому и сервер, и клиент зовут ОДИН экшен — расходится
// только транспорт, а queryKey и форма результата едины.

export const PAGE_SIZE = 20

// Строка списка клиентов на UI (как мапит getClientsList в actions.ts).
export type ClientListItem = {
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

export type ClientsListResult = { clients: ClientListItem[]; total: number }

export type ClientsQueryParams = {
  search: string
  segment: string
  page: number
  conditions: FilterCondition[]
}

// Параметры первого рендера из URL: ?f= → conditions; search/segment/page — дефолты
// клиента (он стартует с пустого поиска, сегмента «Все», страницы 0). Сервер обязан
// строить queryKey ровно из этих значений, иначе дегидрация не совпадёт с useQuery.
export function clientsParamsFromSearch(
  sp: Record<string, string | string[] | undefined>,
): ClientsQueryParams {
  const f = typeof sp.f === 'string' ? sp.f : null
  return { search: '', segment: 'Все', page: 0, conditions: parseConditions(f) }
}

// Стабильный queryKey — ОДИН для серверного префетча и клиентского useQuery.
export function clientsListKey(p: ClientsQueryParams) {
  return [
    'clients-list',
    { search: p.search, segment: p.segment, page: p.page, conditions: p.conditions },
  ] as const
}

// Тонкая обёртка над Server Action getClientsList: бросает на ошибке (как делал клиент
// внутри queryFn), чтобы useQuery ушёл в isError, а серверный prefetch не закэшировал мусор.
export async function fetchClientsList(params: ClientsQueryParams): Promise<ClientsListResult> {
  const res = await getClientsList({
    search: params.search,
    segment: params.segment,
    page: params.page,
    pageSize: PAGE_SIZE,
    conditions: params.conditions,
  })
  if (!res.success) throw new Error(res.error || 'Ошибка при загрузке списка клиентов')
  return { clients: res.clients as ClientListItem[], total: res.total }
}
