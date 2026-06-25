'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getCallerCard, type CallerCard } from './incoming-call-actions'

type InboundRow = {
  id: string
  vpbx_uuid: string | null
  direction: string
  client_id: string | null
  number_a: string | null
  finish_status: string | null
}

export type ActiveCall = {
  uuid: string
  phone: string
  clientId: string | null
  finishStatus: string | null
  loading: boolean
  card: CallerCard | null
}

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU')
}

/** Подпись состояния звонка: идёт / завершён / пропущен. */
export function callStatusLabel(finishStatus: string | null): string {
  if (!finishStatus) return 'Звонит…'
  if (finishStatus === 'ANSWERED') return 'Разговор завершён'
  return 'Пропущенный'
}

/**
 * Глобальный слушатель входящих VPBX-звонков. На входящий звонок показывает
 * ПОСТОЯННУЮ карточку с клиентом и его последним заказом (а не исчезающий тост),
 * чтобы менеджер опознал звонящего и нашёл заказ — и во время, и после разговора.
 * RLS решает, кому приходит событие (ответственный менеджер / админ).
 */
export function IncomingCallNotifier() {
  const [call, setCall] = useState<ActiveCall | null>(null)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    const supabase = createClient()

    const onInbound = async (row: InboundRow) => {
      if (row.direction !== 'inbound') return
      const uuid = row.vpbx_uuid ?? row.id
      if (seen.current.has(uuid)) return
      seen.current.add(uuid)
      setCall({ uuid, phone: row.number_a ?? '', clientId: row.client_id, finishStatus: row.finish_status, loading: Boolean(row.client_id), card: null })
      if (row.client_id) {
        const res = await getCallerCard(row.client_id)
        setCall((prev) => (prev && prev.uuid === uuid ? { ...prev, loading: false, card: res.success ? res.data : null } : prev))
      }
    }

    const onUpdate = (row: InboundRow) => {
      if (row.direction !== 'inbound') return
      const uuid = row.vpbx_uuid ?? row.id
      setCall((prev) => (prev && prev.uuid === uuid ? { ...prev, finishStatus: row.finish_status } : prev))
    }

    const channel = supabase
      .channel('vpbx-incoming')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vpbx_calls' }, (p) => { void onInbound(p.new as InboundRow) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vpbx_calls' }, (p) => { onUpdate(p.new as InboundRow) })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  if (!call) return null
  return <IncomingCallCardView call={call} onClose={() => setCall(null)} />
}

/** Презентационная карточка входящего звонка (вынесена для тестов). */
export function IncomingCallCardView({ call, onClose }: { call: ActiveCall; onClose: () => void }) {
  const client = call.card?.client ?? null
  const order = call.card?.recentOrder ?? null

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-[#ebe9e4] bg-white shadow-2xl p-4 space-y-2.5 animate-in slide-in-from-bottom-2">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a]">Входящий звонок</div>
          <div className="font-semibold text-foreground text-sm">{call.phone || 'Неизвестный номер'}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-emerald-600">{callStatusLabel(call.finishStatus)}</span>
          <button onClick={onClose} aria-label="Закрыть" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {call.loading ? (
        <div className="text-xs text-muted-foreground py-1">Загрузка данных клиента…</div>
      ) : client ? (
        <div className="space-y-2">
          <div>
            <div className="font-bold text-foreground text-sm">{client.name}</div>
            <div className="text-[11px] text-muted-foreground">Заказов: {client.totalOrders} · посл.: {formatDate(client.lastOrderDate)}</div>
          </div>
          {order ? (
            <Link href={`/orders/${order.id}`} className="block rounded-lg border border-[#ebe9e4] bg-[#fcfcfb] p-2 hover:bg-muted/40">
              <div className="text-[11px] font-semibold text-foreground">
                Заказ {order.docNum ? `№${order.docNum}` : ''} · {order.statusName ?? '—'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatDate(order.createdAt)}{order.amount != null ? ` · ${fmtMoney.format(order.amount)} ₸` : ''}
              </div>
            </Link>
          ) : (
            <div className="text-[11px] text-muted-foreground">Заказов пока нет</div>
          )}
          <div className="flex gap-2 pt-0.5">
            <Link href={`/clients/${client.id}`} className="text-xs font-semibold text-blue-700 hover:underline">Открыть клиента</Link>
            {order && <Link href={`/orders/${order.id}`} className="text-xs font-semibold text-blue-700 hover:underline">Открыть заказ</Link>}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Номер не найден в базе клиентов.</div>
          <Link
            href={`/clients?newClientPhone=${encodeURIComponent(call.phone)}`}
            className="inline-block text-xs font-semibold text-blue-700 hover:underline"
          >
            Создать клиента
          </Link>
        </div>
      )}
    </div>
  )
}
