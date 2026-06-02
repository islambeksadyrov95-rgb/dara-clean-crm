import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { Nav } from './nav'

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
    <div className="min-h-screen bg-background">
      <Nav email={email} role={role} />
      <main className="p-6">{children}</main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
