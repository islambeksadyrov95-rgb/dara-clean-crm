import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { AppShell } from './app-shell'
import { IncomingCallNotifier } from './incoming-call-notifier'
import { RecordingSyncDaemon } from './recording-sync-daemon'
import { getUserRole } from '@/lib/auth/get-user-role'
import { QueryProvider } from './query-provider'

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
  // Бейдж перезвонов больше НЕ считается в layout (это блокировало RSC и делало
  // дорогим каждый префетч динамического layout). Sidebar тянет его сам через
  // useQuery один раз и держит свежим через invalidate (событие диспозиции + realtime).

  return (
    <QueryProvider>
      <AppShell email={email} role={role}>
        {children}
      </AppShell>
      <IncomingCallNotifier />
      <RecordingSyncDaemon />
      <Toaster position="top-right" richColors />
    </QueryProvider>
  )
}
