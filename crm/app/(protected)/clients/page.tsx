import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { clientsParamsFromSearch, clientsListKey, fetchClientsList } from './clients-query'
import { getUsersDirectory, getFilterDictionaries, listSavedFilters } from './actions'
import { getSegmentRules } from '../settings/actions'
import { ClientsPageClient } from './clients-client'

export const dynamic = 'force-dynamic'
// Запас по времени серверным экшенам префетча vs таймаут гейтвея (как на /queue).
export const maxDuration = 60

export default async function ClientsPage({
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

  // Параметры первого рендера = дефолты клиента (поиск пуст, сегмент «Все», стр. 0) +
  // condition'ы из ?f=. queryKey строится из них же → дегидрация совпадёт с useQuery клиента.
  const params = clientsParamsFromSearch(sp)

  // SSR-prefetch всех данных первой отрисовки одним серверным проходом (параллельно, рядом с БД).
  // Снимает с клиента и async-getUser гейт, и сериализованные Server Actions на маунте: список +
  // справочники приходят в HTML. queryKey списка и справочников строго совпадают с клиентскими
  // useQuery (clientsListKey + ключи _queries.ts), staleTime справочников 5мин / списка 30с →
  // на первой отрисовке клиентских POST /clients нет.
  const queryClient = new QueryClient()
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: clientsListKey(params),
      queryFn: () => fetchClientsList(params),
    }),
    queryClient.prefetchQuery({ queryKey: ['users-directory'], queryFn: getUsersDirectory }),
    queryClient.prefetchQuery({ queryKey: ['filter-dictionaries'], queryFn: getFilterDictionaries }),
    queryClient.prefetchQuery({ queryKey: ['segment-rules'], queryFn: getSegmentRules }),
    queryClient.prefetchQuery({ queryKey: ['saved-filters', 'clients'], queryFn: () => listSavedFilters('clients') }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ClientsPageClient />
    </HydrationBoundary>
  )
}
