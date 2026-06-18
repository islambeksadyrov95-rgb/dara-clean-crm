'use client'

import { useEffect, useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { fmtTenge } from '@/lib/format'
import { fetchOrdersList, ordersListKey, PAGE_SIZE, type Order } from './orders-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CreateOrderButton } from './create-order-button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const SERVICES = ['Все', 'Ковры', 'Шторы', 'Мебель', 'Клининг'] as const

// Бейдж статуса заказа (значения agbis_status_name из импорта Агбиса).
const STATUS_BADGE: Record<string, string> = {
  'Новый': 'bg-blue-50 text-blue-700 border-blue-200/60',
  'В исполнении': 'bg-amber-50 text-amber-700 border-amber-200/60',
  'Исполненный': 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  'Выданный': 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  'Закрытый': 'bg-gray-50 text-gray-600 border-gray-200/60',
  'Отменённый': 'bg-red-50 text-red-700 border-red-200/60',
}

// Календарная дата (YYYY-MM-DD из order_history) → DD.MM.YYYY, без времени/таймзоны.
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const [yyyy, mm, dd] = dateStr.split('T')[0].split('-')
  if (!yyyy || !mm || !dd) return dateStr
  return `${dd}.${mm}.${yyyy}`
}

const EMPTY_ORDERS: Order[] = []

export function OrdersPageClient() {
  const router = useRouter()
  const supabase = createClient()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedService, setSelectedService] = useState<string>('Все')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  // Список заказов через TanStack Query: queryKey/queryFn — из общего модуля orders-query,
  // тот же, что и в серверном SSR-prefetch (page.tsx) → на первом рендере данные берутся из
  // дегидрации, список виден сразу, без клиентского раунд-трипа. placeholderData держит список
  // при фильтрах/пагинации (без скачка в «Загрузка»).
  const queryParams = { search: debouncedSearch, service: selectedService, dateFrom, dateTo, page }
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ordersListKey(queryParams),
    queryFn: () => fetchOrdersList(supabase, queryParams),
    placeholderData: (prev) => prev,
  })
  const orders = data?.orders ?? EMPTY_ORDERS
  const total = data?.total ?? 0
  const loading = isLoading

  // Ошибку — в toast (generic для пользователя, детали в консоль).
  useEffect(() => {
    if (isError) {
      console.error('[orders-list]', error)
      toast.error('Ошибка загрузки заказов')
    }
  }, [isError, error])

  // Сброс на первую страницу при изменении фильтров
  useEffect(() => {
    Promise.resolve().then(() => {
      setPage(0)
    })
  }, [debouncedSearch, selectedService, dateFrom, dateTo])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Заказы</h1>
        <span className="text-sm text-muted-foreground bg-muted/40 px-3 py-1 rounded-full border border-border/50">
          Всего заказов: {total}
        </span>
      </div>

      <CreateOrderButton />

      {/* Панель фильтров */}
      <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Поиск */}
          <div className="flex-1 min-w-[280px]">
            <label htmlFor="search-input" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
              Поиск по клиенту
            </label>
            <Input
              id="search-input"
              placeholder="Имя или телефон клиента..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#fcfcfb]"
            />
          </div>

          {/* Фильтр по датам */}
          <div className="flex gap-2">
            <div>
              <label htmlFor="date-from" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
                Дата с
              </label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-[#fcfcfb] w-[140px]"
              />
            </div>
            <div>
              <label htmlFor="date-to" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
                Дата по
              </label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-[#fcfcfb] w-[140px]"
              />
            </div>
          </div>

          {/* Сброс фильтров */}
          {(search || dateFrom || dateTo || selectedService !== 'Все') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setDateFrom('')
                setDateTo('')
                setSelectedService('Все')
              }}
              className="text-xs text-[#5c5950] hover:text-foreground h-9 px-3"
            >
              Сбросить фильтры
            </Button>
          )}
        </div>

        {/* Фильтр по услугам */}
        <div className="border-t border-[#ebe9e4] pt-3">
          <label className="text-xs font-semibold text-[#8a877e] mb-2 block">
            Услуга
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {SERVICES.map((s) => (
              <button
                key={s}
                onClick={() => setSelectedService(s)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-all ${
                  selectedService === s
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm font-medium'
                    : 'bg-[#fcfcfb] text-[#5c5950] border-[#ebe9e4] hover:bg-muted/40'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Таблица */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="font-semibold text-foreground">Клиент</TableHead>
              <TableHead className="font-semibold text-foreground">Телефон</TableHead>
              <TableHead className="font-semibold text-foreground">Услуга</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Сумма</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Скидка</TableHead>
              <TableHead className="font-semibold text-foreground">Статус</TableHead>
              <TableHead className="font-semibold text-foreground">№ Агбиса</TableHead>
              <TableHead className="font-semibold text-foreground">Дата заказа</TableHead>
              <TableHead className="font-semibold text-foreground">Выдача</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-12 text-[#8a877e]"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span>Загрузка списка заказов...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-12 text-red-600 bg-red-50/40"
                >
                  Не удалось загрузить заказы. Попробуйте обновить страницу.
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-12 text-[#8a877e] bg-muted/5"
                >
                  Заказы не найдены
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow
                  key={order.id}
                  className="hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/orders/${order.id}`)}
                >
                  <TableCell className="font-medium text-foreground">
                    {order.clients?.name || '—'}
                  </TableCell>
                  <TableCell className="text-[#5c5950] font-mono text-xs">
                    {order.clients?.phone ? (
                      <a
                        href={`tel:${order.clients.phone}`}
                        className="hover:underline hover:text-[#2563eb]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {order.clients.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-[#5c5950] text-sm" title={order.service || ''}>
                    {order.service || '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-[#5c5950]">
                    {fmtTenge(order.amount)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {order.agbis_discount && order.agbis_discount > 0 ? (
                      <span className="text-green-600 font-medium font-mono">
                        −{fmtTenge(order.agbis_discount)}
                      </span>
                    ) : (
                      <span className="text-[#8a877e]">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {order.agbis_status_name ? (
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                          STATUS_BADGE[order.agbis_status_name] ||
                          'bg-gray-50 text-gray-700 border-gray-200/60'
                        }`}
                      >
                        {order.agbis_status_name}
                      </Badge>
                    ) : (
                      <span className="text-[#8a877e]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#5c5950] font-mono text-xs">
                    {order.agbis_doc_num || '—'}
                  </TableCell>
                  <TableCell className="text-[#5c5950] text-xs">
                    {formatDate(order.order_date)}
                  </TableCell>
                  <TableCell className="text-[#5c5950] text-xs">
                    {formatDate(order.agbis_date_out)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#ebe9e4] pt-4">
          <span className="text-xs text-[#8a877e]">
            Показано {(page * PAGE_SIZE) + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} из {total} заказов
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="text-xs h-8"
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs h-8"
            >
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
