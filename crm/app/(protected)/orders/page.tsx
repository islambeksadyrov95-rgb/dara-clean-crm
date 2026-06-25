import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ordersParamsFromSearch, ordersListKey, fetchOrdersList, fetchStuckOrders } from './orders-query'
import { OrdersPageClient } from './orders-client'
import { StuckOrdersBanner } from './stuck-orders-banner'

export const dynamic = 'force-dynamic'
// Запас по времени серверному префетчу vs таймаут гейтвея (как на /queue и /clients).
export const maxDuration = 60

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  // getClaims (а не getUser): сессию уже рефрешнул middleware, здесь нужна только личность
  // — верифицируется локально (ES256/WebCrypto, без сетевого вызова в Auth-сервер).
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null
  if (!userId) redirect('/login')

  // Параметры первого рендера = дефолты клиента (поиск пуст, услуга «Все», без дат, стр. 0).
  // queryKey строится из них же → дегидрация совпадёт с useQuery первого рендера клиента.
  const params = ordersParamsFromSearch(sp)

  // SSR-prefetch списка заказов одним серверным проходом (как /queue: запрос к таблице напрямую
  // request-scoped клиентом, RLS отдаёт свои заказы). Снимает с клиента и async-getUser гейт
  // (роль теперь из layout через useAuth), и Server Action списка на маунте: список приходит в
  // HTML. queryKey строго совпадает с клиентским useQuery (ordersListKey) → на первой отрисовке
  // клиентского запроса к orders нет, видно сразу.
  const queryClient = new QueryClient()
  // Префетч списка + застрявшие заказы (не ушли в Агбис) одним серверным проходом.
  const [, stuckOrders] = await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ordersListKey(params),
      queryFn: () => fetchOrdersList(supabase, params),
    }),
    fetchStuckOrders(supabase),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <StuckOrdersBanner orders={stuckOrders} />
      <OrdersPageClient />
    </HydrationBoundary>
  )
}
