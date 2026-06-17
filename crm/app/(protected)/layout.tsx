import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { AppShell } from './app-shell'
import { IncomingCallNotifier } from './incoming-call-notifier'
import { RecordingSyncDaemon } from './recording-sync-daemon'
import { getUserRole } from '@/lib/auth/get-user-role'
import { QueryProvider } from './query-provider'
import { AuthProvider } from './auth-context'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const role = getUserRole(user) ?? undefined
  const email = user.email ?? ''
  const isAdmin = role === 'admin'
  const hasSip = Boolean(user.user_metadata?.sip_extension || user.user_metadata?.sip_number)
  // Бейдж перезвонов больше НЕ считается в layout (это блокировало RSC и делало
  // дорогим каждый префетч динамического layout). Sidebar тянет его сам через
  // useQuery один раз и держит свежим через invalidate (событие диспозиции + realtime).

  return (
    <QueryProvider>
      <AuthProvider value={{ userId: user.id, role, isAdmin, hasSip }}>
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
