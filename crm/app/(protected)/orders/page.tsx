'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { deleteOrder } from './actions'
import { getUserRole } from '@/lib/auth/get-user-role'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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

const SERVICES = ['Все', 'Ковры', 'Шторы', 'Мебель', 'Клининг'] as const

const SERVICE_BADGE_COLORS: Record<string, string> = {
  'Ковры': 'bg-blue-50 text-blue-700 border-blue-200/60',
  'Шторы': 'bg-purple-50 text-purple-700 border-purple-200/60',
  'Мебель': 'bg-amber-50 text-amber-700 border-amber-200/60',
  'Клининг': 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
}

const PAGE_SIZE = 20

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

type ClientInfo = {
  id: string
  name: string
  phone: string
}

type Order = {
  id: string
  client_id: string
  manager_id: string
  services: string[]
  amount: number
  discount_percent: number
  discount_amount: number
  comment: string | null
  created_at: string
  clients: ClientInfo | null
}

export default function OrdersPage() {
  const router = useRouter()
  const supabase = createClient()

  const [orders, setOrders] = useState<Order[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedService, setSelectedService] = useState<string>('Все')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Получаем роль пользователя
  useEffect(() => {
    async function fetchUserRole() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setRole(getUserRole(user ?? null))
    }
    fetchUserRole()
  }, [supabase])

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const fetchOrders = useCallback(async () => {
    setLoading(true)

    // Запрос с count: 'exact' для пагинации
    let query = supabase
      .from('orders')
      .select(
        `
        id,
        client_id,
        manager_id,
        services,
        amount,
        discount_percent,
        discount_amount,
        comment,
        created_at,
        clients!inner (
          id,
          name,
          phone
        )
      `,
        { count: 'exact' }
      )

    // 1. Поиск по клиенту (имя или телефон)
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`
      query = query.or(`name.ilike.${term},phone.ilike.${term}`, {
        foreignTable: 'clients',
      })
    }

    // 2. Фильтр по услугам
    if (selectedService !== 'Все') {
      query = query.contains('services', [selectedService])
    }

    // 3. Фильтр по датам
    if (dateFrom) {
      query = query.gte('created_at', new Date(dateFrom).toISOString())
    }
    if (dateTo) {
      const endOfDay = new Date(dateTo)
      endOfDay.setHours(23, 59, 59, 999)
      query = query.lte('created_at', endOfDay.toISOString())
    }

    // Сортировка и пагинация
    query = query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    const { data, count, error } = await query

    if (error) {
      toast.error(`Ошибка загрузки заказов: ${error.message}`)
      setOrders([])
      setTotal(0)
    } else {
      // Приводим data к типу Order
      const formattedOrders = (data || []).map((o: any) => {
        // clients может прийти как объект или как массив из-за особенностей генерации типов
        const clientData = Array.isArray(o.clients) ? o.clients[0] : o.clients
        return {
          ...o,
          clients: clientData || null,
        } as Order
      })
      setOrders(formattedOrders)
      setTotal(count ?? 0)
    }

    setLoading(false)
  }, [debouncedSearch, selectedService, dateFrom, dateTo, page, supabase])

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchOrders()
    })
  }, [fetchOrders])

  // Сброс на первую страницу при изменении фильтров
  useEffect(() => {
    Promise.resolve().then(() => {
      setPage(0)
    })
  }, [debouncedSearch, selectedService, dateFrom, dateTo])

  const handleDelete = async (orderId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот заказ?')) return

    const promise = deleteOrder(orderId).then((res) => {
      if (!res.success) {
        throw new Error(res.error)
      }
      fetchOrders()
      return 'Заказ успешно удален'
    })

    toast.promise(promise, {
      loading: 'Удаление заказа...',
      success: (msg) => msg,
      error: (err) => err.message || 'Ошибка удаления заказа',
    })
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const isAdmin = role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Заказы</h1>
        <span className="text-sm text-muted-foreground bg-muted/40 px-3 py-1 rounded-full border border-border/50">
          Всего заказов: {total}
        </span>
      </div>

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
              <TableHead className="font-semibold text-foreground">Услуги</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Сумма</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Скидка</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Итого</TableHead>
              <TableHead className="font-semibold text-foreground">Дата заказа</TableHead>
              <TableHead className="font-semibold text-foreground max-w-xs">Комментарий</TableHead>
              {isAdmin && <TableHead className="text-right font-semibold text-foreground">Действие</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 9 : 8}
                  className="text-center py-12 text-[#8a877e]"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span>Загрузка списка заказов...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 9 : 8}
                  className="text-center py-12 text-[#8a877e] bg-muted/5"
                >
                  Заказы не найдены
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => {
                const finalAmount = order.amount - order.discount_amount
                return (
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
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {order.services.map((service) => (
                          <Badge
                            key={service}
                            variant="outline"
                            className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                              SERVICE_BADGE_COLORS[service] ||
                              'bg-gray-50 text-gray-700 border-gray-200/60'
                            }`}
                          >
                            {service}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-[#5c5950]">
                      {fmtMoney.format(order.amount)} ₸
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {order.discount_percent > 0 ? (
                        <span className="text-green-600 font-medium font-mono">
                          {order.discount_percent}% (−{fmtMoney.format(order.discount_amount)} ₸)
                        </span>
                      ) : (
                        <span className="text-[#8a877e]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-foreground">
                      {fmtMoney.format(finalAmount)} ₸
                    </TableCell>
                    <TableCell className="text-[#5c5950] text-xs">
                      {formatDate(order.created_at)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-[#8a877e] text-xs" title={order.comment || ''}>
                      {order.comment || '—'}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(order.id)
                          }}
                          className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          Удалить
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
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
