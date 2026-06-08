'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Item = { href: string; label: string; soon?: boolean }
type Group = { title: string; items: Item[]; adminOnly?: boolean }

const GROUPS: Group[] = [
  {
    title: 'Работа',
    items: [
      { href: '/inbox', label: 'Диалоги' },
      { href: '/queue', label: 'Очередь звонков' },
      { href: '/clients', label: 'Клиенты' },
      { href: '/broadcasts', label: 'Рассылка' },
      { href: '/orders', label: 'Заказы' },
    ],
  },
  {
    title: 'Аналитика',
    items: [
      { href: '/pipeline', label: 'Воронка' },
      { href: '/calls', label: 'Коммуникации' },
      { href: '/sales-plans', label: 'План продаж' },
      { href: '/motivation', label: 'Моя мотивация' },
    ],
  },
  {
    title: 'Админ',
    adminOnly: true,
    items: [
      { href: '/import', label: 'Импорт' },
      { href: '/settings', label: 'Настройки' },
      { href: '/team', label: 'Команда' },
    ],
  },
]

export function Sidebar({ email, role }: { email: string; role: string | undefined }) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = role === 'admin'

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-[#ebe9e4] bg-[#f7f6f3]">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-[11px] font-extrabold text-background">
          DC
        </span>
        <span className="text-[15px] font-bold text-foreground">Dara Clean</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {GROUPS.filter((g) => !g.adminOnly || isAdmin).map((group) => (
          <div key={group.title} className="mb-1">
            <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[#a8a49a]">
              {group.title}
            </div>
            {group.items.map((item) =>
              item.soon ? (
                <div
                  key={item.href}
                  className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[#b3afa5]"
                  title="Скоро"
                >
                  <span className="h-2 w-2 rounded-full bg-[#d8d5cd]" />
                  {item.label}
                  <span className="ml-auto rounded-full bg-[#e7e4dd] px-1.5 py-0.5 text-[9px] text-[#8a877e]">
                    скоро
                  </span>
                </div>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                    pathname.startsWith(item.href)
                      ? 'bg-white font-medium text-foreground shadow-sm'
                      : 'text-[#5c5950] hover:bg-white/60'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      pathname.startsWith(item.href) ? 'bg-[#2563eb]' : 'bg-[#c4c0b6]'
                    }`}
                  />
                  {item.label}
                </Link>
              )
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-[#ebe9e4] p-3">
        <div className="mb-1.5 truncate px-1 text-[12px] text-[#8a877e]">
          {email} · {role ?? 'менеджер'}
        </div>
        <button
          onClick={handleLogout}
          className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-[#5c5950] transition-colors hover:bg-white/60"
        >
          Выйти
        </button>
      </div>
    </aside>
  )
}
