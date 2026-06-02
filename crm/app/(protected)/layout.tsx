import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { Sidebar } from './sidebar'

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
    <div className="grid min-h-screen grid-cols-[15rem_1fr] bg-[#fcfcfb]">
      <Sidebar email={email} role={role} />
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-4 border-b border-[#ebe9e4] bg-white px-6 py-3">
          <div className="flex h-9 max-w-sm flex-1 items-center rounded-lg border border-[#ebe9e4] px-3 text-[13px] text-muted-foreground">
            Поиск клиента, заказа…
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
      <Toaster position="top-right" richColors />
    </div>
  )
}
