import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { AppShell } from './app-shell'
import { IncomingCallNotifier } from './incoming-call-notifier'
import { RecordingSyncDaemon } from './recording-sync-daemon'
import { getUserRoleFromClaims } from '@/lib/auth/get-user-role'
import { QueryProvider } from './query-provider'
import { AuthProvider } from './auth-context'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  // getClaims (а не getUser): сессию уже рефрешнул middleware, личность верифицируется
  // локально по JWT (ES256/WebCrypto) — без сетевого раунд-трипа в Auth-сервер (syd1)
  // на каждую защищённую навигацию.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims ?? null
  const userId = typeof claims?.sub === 'string' ? claims.sub : null

  if (!userId) {
    redirect('/login')
  }

  const role = getUserRoleFromClaims(claims) ?? undefined
  const email = typeof claims?.email === 'string' ? claims.email : ''
  const isAdmin = role === 'admin'
  const sipMeta = claims?.user_metadata as { sip_extension?: unknown; sip_number?: unknown } | undefined
  const hasSip = Boolean(sipMeta?.sip_extension || sipMeta?.sip_number)
  // Бейдж перезвонов больше НЕ считается в layout (это блокировало RSC и делало
  // дорогим каждый префетч динамического layout). Sidebar тянет его сам через
  // useQuery один раз и держит свежим через invalidate (событие диспозиции + realtime).

  return (
    <QueryProvider>
      <AuthProvider value={{ userId, role, isAdmin, hasSip }}>
        <AppShell email={email} role={role}>
          {children}
        </AppShell>
      </AuthProvider>
      <IncomingCallNotifier />
      <RecordingSyncDaemon />
      <Toaster position="top-right" richColors />
    </QueryProvider>
  )
}
