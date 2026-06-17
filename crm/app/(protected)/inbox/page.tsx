import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { inboxDefaultChannelId, inboxChatUrlKey, fetchInboxChatUrl } from './inbox-query'
import { InboxPageClient } from './inbox-client'

export const dynamic = 'force-dynamic'
// Запас по времени серверному префетчу (sync пользователя + v3/iframe в Wazzup) vs таймаут
// гейтвея — как на /queue и /clients.
export const maxDuration = 60

export default async function InboxPage() {
  const supabase = await createClient()
  // getClaims (а не getUser): сессию уже рефрешнул middleware, здесь нужна только личность
  // — верифицируется локально (ES256/WebCrypto, без сетевого вызова в Auth-сервер).
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null
  if (!userId) redirect('/login')

  // Канал первого рендера = первая вкладка (клиент стартует с того же). queryKey строится из
  // него же → дегидрация совпадёт с useQuery первого рендера клиента.
  const channelId = inboxDefaultChannelId()

  // SSR-prefetch URL глобального Wazzup-iframe дефолтного канала на сервере. Снимает с клиента
  // и async-getUser гейт (личность из layout через useAuth), и Server Action на маунте
  // (getWazzupGlobalChatUrl сериализовался в очереди роутера и платил полный раунд-трип
  // эдж↔Wazzup): URL приходит в HTML, на первой отрисовке iframe виден сразу, без спиннера.
  // queryKey строго совпадает с клиентским useQuery (inboxChatUrlKey).
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery({
    queryKey: inboxChatUrlKey(channelId),
    queryFn: () => fetchInboxChatUrl(channelId),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxPageClient />
    </HydrationBoundary>
  )
}
