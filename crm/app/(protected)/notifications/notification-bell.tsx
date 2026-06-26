'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Phone, PhoneMissed, PhoneIncoming, Clock, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { makeSipCall } from '@/lib/vpbx/actions'
import { getNotifications, markNotificationRead, markAllNotificationsRead } from './actions'
import { relativeTime, notificationTitle, type NotificationItem } from './notification-feed'

const REFETCH_MS = 60_000
const STALE_MS = 30_000

/** Колокольчик уведомлений в шапке: бейдж + панель (входящие звонки + дозревшие задачи). */
export function NotificationBell() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    refetchInterval: REFETCH_MS,
    staleTime: STALE_MS,
  })

  // Живой бейдж: любое изменение notifications → перезапрос (RLS отдаёт только свои/командные).
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('notifications-bell')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () =>
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  // Закрытие по клику вне панели.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  const unread = data?.success ? data.unreadCount : 0

  const handleMarkAll = async () => {
    await markAllNotificationsRead()
    refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#ebe9e4] text-foreground transition-colors hover:bg-[#f7f6f3]"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[360px] max-w-[90vw] rounded-xl border border-[#ebe9e4] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#ebe9e4] px-4 py-2.5">
            <span className="text-sm font-bold text-foreground">Уведомления</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={handleMarkAll} className="text-[11px] font-semibold text-blue-700 hover:underline">
                  Прочитать все
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Закрыть" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <NotificationList data={data} isLoading={isLoading} onAction={refresh} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

function NotificationList({
  data,
  isLoading,
  onAction,
  onNavigate,
}: {
  data: Awaited<ReturnType<typeof getNotifications>> | undefined
  isLoading: boolean
  onAction: () => void
  onNavigate: () => void
}) {
  if (isLoading) return <div className="px-4 py-8 text-center text-xs text-muted-foreground">Загрузка…</div>
  if (!data || !data.success) return <div className="px-4 py-8 text-center text-xs text-red-600">Не удалось загрузить уведомления</div>
  if (data.items.length === 0) return <div className="px-4 py-8 text-center text-xs text-muted-foreground">Новых уведомлений нет</div>

  return (
    <div className="max-h-[70vh] overflow-y-auto py-1">
      {data.items.map((item) => (
        <NotificationRow key={item.id} item={item} onAction={onAction} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function rowIcon(item: NotificationItem) {
  if (item.kind === 'callback_due') return <Clock className="h-4 w-4 text-amber-600" />
  if (item.subtype === 'missed') return <PhoneMissed className="h-4 w-4 text-red-600" />
  if (item.subtype === 'answered') return <Phone className="h-4 w-4 text-muted-foreground" />
  return <PhoneIncoming className="h-4 w-4 text-blue-600" />
}

function NotificationRow({
  item,
  onAction,
  onNavigate,
}: {
  item: NotificationItem
  onAction: () => void
  onNavigate: () => void
}) {
  const markRead = async () => {
    if (item.kind === 'call_inbound') {
      await markNotificationRead(item.id)
      onAction()
    }
  }

  const handleCall = async () => {
    if (!item.phone) { toast.error('Нет номера для звонка'); return }
    await markRead()
    const res = await makeSipCall(item.phone, item.clientId ?? undefined)
    if (res.success) toast.success('Звоним…')
    else toast.error(res.error)
  }

  return (
    <div className={`flex gap-2.5 px-4 py-2.5 hover:bg-muted/30 ${item.status === 'unread' ? 'bg-blue-50/30' : ''}`}>
      <div className="mt-0.5 shrink-0">{rowIcon(item)}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">{notificationTitle(item)}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(item.at, Date.now())}</span>
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {item.clientName ?? item.phone ?? 'Неизвестный номер'}
          {item.clientName && item.phone ? ` · ${item.phone}` : ''}
        </div>
        <div className="flex gap-3 pt-0.5">
          <button onClick={handleCall} className="text-[11px] font-semibold text-blue-700 hover:underline">
            Перезвонить
          </button>
          {item.clientId && (
            <Link
              href={`/clients/${item.clientId}`}
              onClick={() => { void markRead(); onNavigate() }}
              className="text-[11px] font-semibold text-blue-700 hover:underline"
            >
              Открыть клиента
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
