import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { parseConditions } from '@/lib/filters/url'
import { fetchQueueList, queueListKey, parsePresetIndex, FILTER_PRESETS, PARAM_SEGMENT } from './queue-query'
import { QueuePageClient } from './queue-client'

export const dynamic = 'force-dynamic'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Те же значения, что клиент берёт из useAuth + URL на первом рендере — чтобы queryKey
  // серверного префетча совпал с клиентским и сработала дегидрация.
  const isAdmin = getUserRole(user) === 'admin'
  const seg = typeof sp[PARAM_SEGMENT] === 'string' ? (sp[PARAM_SEGMENT] as string) : null
  const f = typeof sp.f === 'string' ? sp.f : null
  const preset = FILTER_PRESETS[parsePresetIndex(seg)]
  const params = {
    presetMin: preset.min, presetMax: preset.max, userId: user.id, isAdmin,
    pageSize: 50, conditions: parseConditions(f), viewManagerId: null,
  }

  // SSR-prefetch списка: данные кладутся в HTML, клиент гидрируется уже с ними →
  // список виден на первой отрисовке, без клиентского запроса через ~3.6с после гидрации.
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery({
    queryKey: queueListKey(params),
    queryFn: () => fetchQueueList(supabase, params),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <QueuePageClient />
    </HydrationBoundary>
  )
}
