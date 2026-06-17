import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserRoleFromClaims } from '@/lib/auth/get-user-role'
import { parseConditions } from '@/lib/filters/url'
import { fetchQueueList, queueListKey, parsePresetIndex, FILTER_PRESETS, PARAM_SEGMENT } from './queue-query'
import { getDayStats, getScheduledCallbacks } from './actions'
import { getUsersDirectory, getFilterDictionaries, listSavedFilters } from '../clients/actions'
import { getSegmentRules, getSettings } from '../settings/actions'
import { QueuePageClient } from './queue-client'

export const dynamic = 'force-dynamic'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  // getClaims (а не getUser): сессию уже рефрешнул middleware, здесь нужна только личность
  // — верифицируется локально (ES256/WebCrypto, без сетевого вызова в Auth-сервер).
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims ?? null
  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) redirect('/login')

  // Те же значения, что клиент берёт из useAuth + URL на первом рендере — чтобы queryKey
  // серверного префетча совпал с клиентским и сработала дегидрация.
  const isAdmin = getUserRoleFromClaims(claims) === 'admin'
  const seg = typeof sp[PARAM_SEGMENT] === 'string' ? (sp[PARAM_SEGMENT] as string) : null
  const f = typeof sp.f === 'string' ? sp.f : null
  const preset = FILTER_PRESETS[parsePresetIndex(seg)]
  const params = {
    presetMin: preset.min, presetMax: preset.max, userId, isAdmin,
    pageSize: 50, conditions: parseConditions(f), viewManagerId: null,
  }

  // SSR-prefetch всех данных первой отрисовки одним серверным проходом (параллельно, рядом с БД).
  // ИЗМЕРЕНО на проде (Chrome DevTools, x-vercel-id: fra1::syd1): клиентские Server Actions
  // сериализуются (router action queue, 13/13 пар встык) и каждый платит полный раунд-трип
  // эдж↔Сидней (~970мс при теле 2 байта — это сеть, не работа БД). 14 экшенов в очередь = ~14с.
  // Префетч на сервере снимает их с клиентской очереди: данные приходят в HTML, на первой
  // отрисовке клиентских POST /queue нет. queryKey строго совпадают с клиентскими useQuery
  // (viewManagerId=null на старте; staleTime справочников 5мин / queries 30с → без рефетча).
  const queryClient = new QueryClient()
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queueListKey(params),
      queryFn: () => fetchQueueList(supabase, params),
    }),
    queryClient.prefetchQuery({ queryKey: ['queue-stats', null], queryFn: () => getDayStats(null) }),
    queryClient.prefetchQuery({ queryKey: ['queue-callbacks'], queryFn: () => getScheduledCallbacks() }),
    queryClient.prefetchQuery({ queryKey: ['users-directory'], queryFn: getUsersDirectory }),
    queryClient.prefetchQuery({ queryKey: ['filter-dictionaries'], queryFn: getFilterDictionaries }),
    queryClient.prefetchQuery({ queryKey: ['segment-rules'], queryFn: getSegmentRules }),
    queryClient.prefetchQuery({ queryKey: ['settings'], queryFn: getSettings }),
    queryClient.prefetchQuery({ queryKey: ['saved-filters', 'queue'], queryFn: () => listSavedFilters('queue') }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <QueuePageClient />
    </HydrationBoundary>
  )
}
