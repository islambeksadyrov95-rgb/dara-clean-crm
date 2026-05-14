'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const dynamic = 'force-dynamic'

const SEGMENTS = ['Все', 'Новый', 'Повторный', 'Постоянный', 'В риске', 'Потерянный'] as const

const SEGMENT_COLORS: Record<string, string> = {
  'Новый': 'bg-blue-100 text-blue-800',
  'Повторный': 'bg-green-100 text-green-800',
  'Постоянный': 'bg-emerald-100 text-emerald-800',
  'В риске': 'bg-yellow-100 text-yellow-800',
  'Потерянный': 'bg-red-100 text-red-800',
}

const PAGE_SIZE = 20

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

type Client = {
  id: string
  name: string
  phone: string
  total_orders: number
  total_spent: number
  last_order_date: string | null
  rfm_segment: string
  days_since_last_order: number | null
}

export default function ClientsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState<string>('Все')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchClients = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('client_segments')
      .select('*', { count: 'exact' })

    if (search.trim()) {
      const term = `%${search.trim()}%`
      query = query.or(`name.ilike.${term},phone.ilike.${term}`)
    }

    if (segment !== 'Все') {
      query = query.eq('rfm_segment', segment)
    }

    query = query
      .order('last_order_date', { ascending: true, nullsFirst: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    const { data, count } = await query

    setClients((data as Client[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [search, segment, page]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  // Сброс страницы при смене фильтров
  useEffect(() => {
    setPage(0)
  }, [search, segment])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Клиенты</h1>

      {/* Фильтры */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <Input
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {SEGMENTS.map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                segment === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-border hover:bg-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Таблица */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Сегмент</TableHead>
              <TableHead className="text-right">Заказов</TableHead>
              <TableHead className="text-right">Потрачено</TableHead>
              <TableHead>Последний заказ</TableHead>
              <TableHead className="text-right">Дней без заказа</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Клиенты не найдены
                </TableCell>
              </TableRow>
            ) : (
              clients.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/clients/${c.id}`)}
                >
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={SEGMENT_COLORS[c.rfm_segment] ?? ''}
                    >
                      {c.rfm_segment}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{c.total_orders}</TableCell>
                  <TableCell className="text-right">
                    {fmtMoney.format(c.total_spent)} ₸
                  </TableCell>
                  <TableCell>{formatDate(c.last_order_date)}</TableCell>
                  <TableCell className="text-right">
                    {c.days_since_last_order != null ? `${c.days_since_last_order} дн.` : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {total} клиентов, стр. {page + 1} из {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 hover:bg-muted"
            >
              Назад
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 hover:bg-muted"
            >
              Вперёд
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
