'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getCallbackBadgeCount } from './search-actions'
import { CALLBACKS_CHANGED_EVENT } from '@/lib/callback-events'

type Item = { href?: string; label: string; soon?: boolean; badge?: 'callbacks'; children?: Item[] }
type Group = { title: string; items: Item[]; adminOnly?: boolean }

const GROUPS: Group[] = [
  {
    title: 'Работа',
    items: [
      { href: '/inbox', label: 'Диалоги' },
      { href: '/queue', label: 'Очередь звонков', badge: 'callbacks' },
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
      { href: '/dashboard', label: 'Дашборд' },
      { href: '/import', label: 'Импорт' },
      { href: '/settings', label: 'Настройки' },
      { href: '/settings/segments', label: 'Сегменты' },
      { href: '/settings/sources', label: 'Источники' },
      {
        label: 'Интеграции',
        children: [
          { href: '/settings/integrations/agbis', label: 'Агбис' },
          { href: '/settings/integrations/telephony', label: 'Телефония' },
          { href: '/settings/integrations/wazzup', label: 'Wazzup' },
        ],
      },
      { href: '/team', label: 'Команда' },
    ],
  },
]

function NavLeaf({
  item,
  active,
  indented,
  callbackCount,
}: {
  item: Item
  active: boolean
  indented?: boolean
  callbackCount: number
}) {
  return (
    <Link
      href={item.href ?? '#'}
      className={`flex items-center gap-2.5 rounded-lg py-2 text-[13.5px] transition-colors ${
        indented ? 'pl-7 pr-3' : 'px-3'
      } ${active ? 'bg-white font-medium text-foreground shadow-sm' : 'text-[#5c5950] hover:bg-white/60'}`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#2563eb]' : 'bg-[#c4c0b6]'}`} />
      {item.label}
      {item.badge === 'callbacks' && callbackCount > 0 && (
        <span
          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2563eb] px-1.5 text-[10px] font-semibold text-white"
          title="Перезвоны на сегодня"
        >
          {callbackCount}
        </span>
      )}
    </Link>
  )
}

function NavParent({ item, pathname, callbackCount }: { item: Item; pathname: string; callbackCount: number }) {
  const children = item.children ?? []
  const hasActiveChild = children.some((c) => c.href && pathname.startsWith(c.href))
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? hasActiveChild

  return (
    <div>
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
          hasActiveChild ? 'font-medium text-foreground' : 'text-[#5c5950] hover:bg-white/60'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${hasActiveChild ? 'bg-[#2563eb]' : 'bg-[#c4c0b6]'}`} />
        {item.label}
        <ChevronRight className={`ml-auto h-3.5 w-3.5 text-[#a8a49a] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open &&
        children.map((child) => (
          <NavLeaf
            key={child.href}
            item={child}
            active={!!child.href && pathname.startsWith(child.href)}
            indented
            callbackCount={callbackCount}
          />
        ))}
    </div>
  )
}

export function Sidebar({
  email,
  role,
  initialCallbackCount,
}: {
  email: string
  role: string | undefined
  initialCallbackCount: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = role === 'admin'
  // Начальное значение приходит с сервера (RSC) — без клиентского запроса на загрузке.
  const [callbackCount, setCallbackCount] = useState(initialCallbackCount)

  // Свежесть бейджа гарантируется пересчётом при навигации (pull). Первый рендер
  // пропускаем — значение уже пришло с сервера (RSC), повторный запрос не нужен.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    let active = true
    void getCallbackBadgeCount().then((count) => { if (active) setCallbackCount(count) })
    return () => { active = false }
  }, [pathname])

  // Синхронное обновление: панель звонка шлёт CALLBACKS_CHANGED_EVENT сразу после
  // записи диспозиции (в этом же браузере) — бейдж пересчитывается мгновенно. Бейдж
  // считает перезвоны только текущего менеджера, и меняют их только его действия здесь,
  // поэтому window-событие надёжнее cross-client realtime. Realtime оставлен бонусом
  // (мульти-таб/другая сессия) — заработает, когда Supabase подхватит call_logs.
  useEffect(() => {
    const supabase = createClient()
    let active = true
    const refresh = () => {
      void getCallbackBadgeCount().then((count) => { if (active) setCallbackCount(count) })
    }
    window.addEventListener(CALLBACKS_CHANGED_EVENT, refresh)
    const channel = supabase
      .channel('sidebar-callbacks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, refresh)
      .subscribe()
    return () => {
      active = false
      window.removeEventListener(CALLBACKS_CHANGED_EVENT, refresh)
      supabase.removeChannel(channel)
    }
  }, [])

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
            {group.items.map((item) => {
              if (item.children) {
                return <NavParent key={item.label} item={item} pathname={pathname} callbackCount={callbackCount} />
              }
              if (item.soon) {
                return (
                  <div
                    key={item.label}
                    className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[#b3afa5]"
                    title="Скоро"
                  >
                    <span className="h-2 w-2 rounded-full bg-[#d8d5cd]" />
                    {item.label}
                    <span className="ml-auto rounded-full bg-[#e7e4dd] px-1.5 py-0.5 text-[9px] text-[#8a877e]">
                      скоро
                    </span>
                  </div>
                )
              }
              return (
                <NavLeaf
                  key={item.href}
                  item={item}
                  active={!!item.href && pathname.startsWith(item.href)}
                  callbackCount={callbackCount}
                />
              )
            })}
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
