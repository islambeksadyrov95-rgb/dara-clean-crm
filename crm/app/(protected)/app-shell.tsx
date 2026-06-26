'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from './sidebar'
import { GlobalSearch } from '@/components/global-search'
import { RecordingFolderBanner } from './recording-folder-banner'
import { NotificationBell } from './notifications/notification-bell'

const STORAGE_KEY = 'dc-sidebar-collapsed'

export function AppShell({
  email,
  role,
  children,
}: {
  email: string
  role: string | undefined
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') {
        Promise.resolve().then(() => {
          setCollapsed(true)
        })
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [])

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <div
      className={`grid min-h-screen bg-[#fcfcfb] ${
        collapsed ? 'grid-cols-1' : 'grid-cols-[15rem_1fr]'
      }`}
    >
      {!collapsed && <Sidebar email={email} role={role} />}
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-[#ebe9e4] bg-white px-4 py-3">
          <button
            onClick={toggle}
            aria-label={collapsed ? 'Показать меню' : 'Скрыть меню'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#ebe9e4] text-foreground transition-colors hover:bg-[#f7f6f3]"
          >
            <span className="flex flex-col gap-[3px]">
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
            </span>
          </button>
          {collapsed && (
            <span className="text-[14px] font-bold text-foreground">Dara Clean</span>
          )}
          <GlobalSearch />
          <NotificationBell />
        </header>
        <RecordingFolderBanner />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
