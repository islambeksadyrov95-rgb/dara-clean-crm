import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { AppShell } from './app-shell'
import { IncomingCallNotifier } from './incoming-call-notifier'

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

  const role = user.user_metadata?.role as string | undefined
  const email = user.email ?? ''

  return (
    <>
      <AppShell email={email} role={role}>
        {children}
      </AppShell>
      <IncomingCallNotifier />
      <Toaster position="top-right" richColors />
    </>
  )
}
