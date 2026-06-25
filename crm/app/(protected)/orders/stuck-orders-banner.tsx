'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import type { StuckOrder } from './orders-query'

/**
 * Предупреждение о застрявших заказах: CRM-заказы, которые не ушли в Агбис
 * (sync_status pending/failed) → курьеры их НЕ видят. Менеджер должен знать и разобраться.
 */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU')
}

export function StuckOrdersBanner({ orders }: { orders: StuckOrder[] }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || orders.length === 0) return null

  return (
    <div className="flex gap-3 p-4 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs shadow-xs">
      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="space-y-1 flex-1">
        <span className="font-bold block text-[13px]">
          {orders.length} заказ(ов) не ушли в Агбис — курьеры их не видят
        </span>
        <ul className="space-y-0.5">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="font-semibold hover:underline">
                {o.client_name ?? 'Без имени'}
              </Link>
              {' · '}{o.sync_error ?? o.sync_status ?? '—'}{' · '}{formatDate(o.created_at)}
            </li>
          ))}
        </ul>
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Закрыть" className="text-amber-700 hover:text-amber-900 shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
