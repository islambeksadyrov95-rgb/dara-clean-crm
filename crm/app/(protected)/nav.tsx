'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

type Props = {
  email: string
  role: string | undefined
}

const NAV_ITEMS = [
  { href: '/queue', label: 'Очередь' },
  { href: '/calls', label: 'Коммуникации' },
  { href: '/clients', label: 'Клиенты' },
] as const

const ADMIN_ITEMS = [
  { href: '/dashboard', label: 'Сводка' },
  { href: '/import', label: 'Импорт' },
  { href: '/settings', label: 'Настройки' },
] as const

export function Nav({ email, role }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="border-b px-6 py-3 flex items-center justify-between">
      <nav className="flex items-center gap-4">
        <span className="font-semibold text-sm">Dara Clean CRM</span>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`text-sm transition-colors ${
              pathname.startsWith(item.href)
                ? 'text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        ))}
        {role === 'admin' && ADMIN_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`text-sm transition-colors ${
              pathname.startsWith(item.href)
                ? 'text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {email} · {role ?? 'менеджер'}
        </span>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs text-muted-foreground">
          Выйти
        </Button>
      </div>
    </header>
  )
}
