'use client'

import { useEffect, useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { fmtTenge } from '@/lib/format'
import {
  fetchOrdersList,
  fetchOrdersTotals,
  fetchOrderManagers,
  ordersListKey,
  ordersTotalsKey,
  ordersParamsFromUrl,
  ordersParamsToQuery,
  ORDER_STATUS_OPTIONS,
  PAGE_SIZE,
  type Order,
  type PaymentFilter,
} from './orders-query'
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

// Общий класс для нативных select-фильтров (статус/приёмщик/оплата) — стиль под Input.
const SELECT_CLS =
  'flex h-9 w-[160px] rounded-md border border-input bg-[#fcfcfb] px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'

const PAYMENT_OPTIONS: { value: PaymentFilter; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'debt', label: 'С долгом' },
  { value: 'paid', label: 'Без долга' },
]

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
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Стартовое состояние из URL (тот же парсер, что и SSR-префетч) → queryKey первого рендера
  // совпадает с серверным, а возврат из карточки /orders/[id] восстанавливает страницу и фильтры.
  const initialRef = useRef(ordersParamsFromUrl(new URLSearchParams(searchParams.toString())))
  const initial = initialRef.current

  const [search, setSearch] = useState(initial.search)
  const [debouncedSearch, setDebouncedSearch] = useState(initial.search)
  const [selectedService, setSelectedService] = useState<string>(initial.service)
  const [status, setStatus] = useState(initial.status)
  const [manager, setManager] = useState(initial.manager)
  const [payment, setPayment] = useState<PaymentFilter>(initial.payment)
  const [dateFrom, setDateFrom] = useState(initial.dateFrom)
  const [dateTo, setDateTo] = useState(initial.dateTo)
  const [includeCancelled, setIncludeCancelled] = useState(initial.includeCancelled)
  const [page, setPage] = useState(initial.page)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didMountRef = useRef(false)

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
  const queryParams = {
    search: debouncedSearch,
    service: selectedService,
    status,
    manager,
    payment,
    dateFrom,
    dateTo,
    includeCancelled,
    page,
  }
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ordersListKey(queryParams),
    queryFn: () => fetchOrdersList(supabase, queryParams),
    placeholderData: (prev) => prev,
  })

  // Опции приёмщиков (distinct agbis_user_name) — один раз за сессию, не меняются при фильтрах.
  const { data: managerOptions } = useQuery({
    queryKey: ['order-managers'],
    queryFn: () => fetchOrderManagers(supabase),
    staleTime: Infinity,
  })
  // Итоги по текущему фильтру (весь набор, не только страница) — отдельный RPC-агрегат.
  // queryKey без page → не рефетчится при перелистывании.
  const {
    data: totals,
    isError: totalsError,
    isLoading: totalsLoading,
  } = useQuery({
    queryKey: ordersTotalsKey(queryParams),
    queryFn: () => fetchOrdersTotals(supabase, queryParams),
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

  // Сброс на первую страницу при изменении фильтров — но НЕ на маунте, иначе затрём page из URL.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    setPage(0)
  }, [debouncedSearch, selectedService, status, manager, payment, dateFrom, dateTo, includeCancelled])

  // Состояние → URL (router.replace, без скролла). Пишем, не читаем обратно: источник правды —
  // state; URL нужен только чтобы возврат из карточки /orders/[id] восстановил страницу и фильтры.
  useEffect(() => {
    const qs = ordersParamsToQuery({
      search: debouncedSearch,
      service: selectedService,
      status,
      manager,
      payment,
      dateFrom,
      dateTo,
      includeCancelled,
      page,
    })
    router.replace(qs ? `/orders?${qs}` : '/orders', { scroll: false })
  }, [router, debouncedSearch, selectedService, status, manager, payment, dateFrom, dateTo, includeCancelled, page])

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

          {/* Статус */}
          <div>
            <label htmlFor="status-filter" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
              Статус
            </label>
            <select
              id="status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={SELECT_CLS}
            >
              <option value="">Все</option>
              {ORDER_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Приёмщик */}
          <div>
            <label htmlFor="manager-filter" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
              Приёмщик
            </label>
            <select
              id="manager-filter"
              value={manager}
              onChange={(e) => setManager(e.target.value)}
              className={SELECT_CLS}
            >
              <option value="">Все</option>
              {(managerOptions ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Оплата */}
          <div>
            <label htmlFor="payment-filter" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
              Оплата
            </label>
            <select
              id="payment-filter"
              value={payment}
              onChange={(e) => {
                const v = e.target.value
                setPayment(v === 'debt' || v === 'paid' ? v : '')
              }}
              className={SELECT_CLS}
            >
              {PAYMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Показывать отменённые — как галочка «Отображать отменённые» в Агбисе (по умолчанию скрыты) */}
          <div>
            <span className="text-xs font-semibold text-[#8a877e] mb-1.5 block">Отменённые</span>
            <label className="flex h-9 items-center gap-2 text-sm text-[#5c5950] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Показывать
            </label>
          </div>

          {/* Сброс фильтров */}
          {(search || dateFrom || dateTo || selectedService !== 'Все' || status || manager || payment || includeCancelled) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setDateFrom('')
                setDateTo('')
                setSelectedService('Все')
                setStatus('')
                setManager('')
                setPayment('')
                setIncludeCancelled(false)
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
              <TableHead className="text-right font-semibold text-foreground">Оплачено</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Долг</TableHead>
              <TableHead className="font-semibold text-foreground">Статус</TableHead>
              <TableHead className="font-semibold text-foreground">Приёмщик</TableHead>
              <TableHead className="font-semibold text-foreground">№ Агбиса</TableHead>
              <TableHead className="text-center font-semibold text-foreground">Выезд</TableHead>
              <TableHead className="font-semibold text-foreground">Адрес</TableHead>
              <TableHead className="font-semibold text-foreground">Дата заказа</TableHead>
              <TableHead className="font-semibold text-foreground">Выдача</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={14}
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
                  colSpan={14}
                  className="text-center py-12 text-red-600 bg-red-50/40"
                >
                  Не удалось загрузить заказы. Попробуйте обновить страницу.
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={14}
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
                    {/* agbis_discount — это ПРОЦЕНТ (lib/agbis/sync-types.ts: discount // percent), не тенге. */}
                    {order.agbis_discount && order.agbis_discount > 0 ? (
                      <span className="text-green-600 font-medium font-mono">
                        −{order.agbis_discount}%
                      </span>
                    ) : (
                      <span className="text-[#8a877e]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-[#5c5950]">
                    {order.agbis_debet ? fmtTenge(order.agbis_debet) : <span className="text-[#8a877e]">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {order.agbis_dolg && order.agbis_dolg > 0 ? (
                      <span className="text-red-600 font-medium">{fmtTenge(order.agbis_dolg)}</span>
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
                  <TableCell className="text-[#5c5950] text-sm">
                    {order.agbis_user_name || <span className="text-[#8a877e]">—</span>}
                  </TableCell>
                  <TableCell className="text-[#5c5950] font-mono text-xs">
                    {order.agbis_doc_num || '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    {order.has_trip === true ? (
                      <span title="Есть выезд" className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 align-middle" />
                    ) : order.has_trip === false ? (
                      <span title="Без выезда (самовывоз)" className="inline-block w-2.5 h-2.5 rounded-full bg-[#d6d3ca] align-middle" />
                    ) : (
                      <span className="text-[#8a877e]">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate text-[#5c5950] text-xs"
                    title={order.address || ''}
                  >
                    {order.address || <span className="text-[#8a877e]">—</span>}
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

      {/* Итоги по текущему фильтру — весь набор, не только страница (RPC-агрегат). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-muted/20 px-4 py-3 text-sm">
        {totalsError ? (
          <span className="text-red-600">Не удалось посчитать итоги за период</span>
        ) : totalsLoading && !totals ? (
          <span className="text-[#8a877e]">Подсчёт итогов...</span>
        ) : (
          <>
            <span className="font-medium text-[#8a877e]">Итоги за период:</span>
            <span className="text-[#5c5950]">
              Заказов: <b className="text-foreground">{totals?.orderCount ?? 0}</b>
            </span>
            <span className="text-[#5c5950]">
              Сумма: <b className="font-mono text-foreground">{fmtTenge(totals?.totalAmount ?? 0)}</b>
            </span>
            <span className="text-[#5c5950]">
              Ковров: <b className="text-foreground">{totals?.totalCarpets ?? 0}</b>
              <span className="ml-1 text-xs text-[#8a877e]">(история прибл.)</span>
            </span>
          </>
        )}
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
