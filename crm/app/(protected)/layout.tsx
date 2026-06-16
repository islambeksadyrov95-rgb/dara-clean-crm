import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { AppShell } from './app-shell'
import { IncomingCallNotifier } from './incoming-call-notifier'
import { RecordingSyncDaemon } from './recording-sync-daemon'
import { getUserRole } from '@/lib/auth/get-user-role'
import { getCallbackBadgeCount } from './search-actions'
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
  // Server-render the callback badge once (no client fetch on load); the sidebar
  // keeps it fresh via realtime on call_logs instead of refetching per navigation.
  const initialCallbackCount = await getCallbackBadgeCount()

  return (
    <QueryProvider>
      <AppShell email={email} role={role} initialCallbackCount={initialCallbackCount}>
        {children}
      </AppShell>
      <IncomingCallNotifier />
      <RecordingSyncDaemon />
      <Toaster position="top-right" richColors />
    </QueryProvider>
  )
}
