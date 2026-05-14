import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <nav className="flex items-center gap-4">
          <span className="font-semibold text-sm">Dara Clean CRM</span>
          <Link href="/clients" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Клиенты
          </Link>
        </nav>
        <span className="text-sm text-muted-foreground">
          {email} · {role ?? 'неизвестная роль'}
        </span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
