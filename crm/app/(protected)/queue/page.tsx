'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { lockClient, unlockClient, recordDisposition, getDayStats } from './actions'
import { Button } from '@/components/ui/button'
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

const SEGMENT_COLORS: Record<string, string> = {
  'Новый': 'bg-blue-100 text-blue-800',
  'Повторный': 'bg-green-100 text-green-800',
  'Постоянный': 'bg-emerald-100 text-emerald-800',
  'В риске': 'bg-yellow-100 text-yellow-800',
  'Потерянный': 'bg-red-100 text-red-800',
}

const REFRESH_INTERVAL = 30_000

type QueueClient = {
  id: string
  name: string
  phone: string
  rfm_segment: string
  days_since_last_order: number | null
  locked_by: string | null
  locked_until: string | null
}

type DayStats = {
  calls: number
  reached: number
  orders: number
}

export default function QueuePage() {
  const supabase = createClient()
  const router = useRouter()
  const [clients, setClients] = useState<QueueClient[]>([])
  const [minDays, setMinDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [locking, setLocking] = useState<string | null>(null)
  const [disposing, setDisposing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [myLocked, setMyLocked] = useState<QueueClient | null>(null)
  const [stats, setStats] = useState<DayStats>({ calls: 0, reached: 0, orders: 0 })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Получить текущего пользователя
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStats = useCallback(async () => {
    const s = await getDayStats()
    setStats(s)
  }, [])

  const fetchQueue = useCallback(async () => {
    // Сначала проверим, есть ли у текущего менеджера активный лок
    if (userId) {
      const { data: locked } = await supabase
        .from('client_segments')
        .select('id, name, phone, rfm_segment, days_since_last_order, locked_by, locked_until')
        .eq('locked_by', userId)
        .gt('locked_until', new Date().toISOString())
        .limit(1)
        .single()

      setMyLocked(locked as QueueClient | null)
    }

    // Очередь: клиенты без активного лока, с достаточным количеством дней без заказа
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('client_segments')
      .select('id, name, phone, rfm_segment, days_since_last_order, locked_by, locked_until')
      .gte('days_since_last_order', minDays)
      .or(`locked_by.is.null,locked_until.lt.${now}`)
      .order('days_since_last_order', { ascending: false })
      .limit(50)

    setClients((data as QueueClient[]) ?? [])
    setLoading(false)
  }, [minDays, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchQueue()
    fetchStats()
  }, [fetchQueue, fetchStats])

  // Автообновление каждые 30 секунд
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchQueue()
      fetchStats()
    }, REFRESH_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchQueue, fetchStats])

  // Supabase Realtime: подписка на изменения locked_by
  useEffect(() => {
    const channel = supabase
      .channel('queue-locks')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clients', filter: 'locked_by=neq.SKIP' },
        () => {
          fetchQueue()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLock = async (clientId: string) => {
    setLocking(clientId)
    const result = await lockClient(clientId)
    if (!result.success) {
      alert(result.error)
    }
    await fetchQueue()
    setLocking(null)
  }

  const handleUnlock = async (clientId: string) => {
    setLocking(clientId)
    const result = await unlockClient(clientId)
    if (!result.success) {
      alert(result.error)
    }
    await fetchQueue()
    setLocking(null)
  }

  const handleDisposition = async (status: 'reached' | 'not_reached') => {
    if (!myLocked) return
    setDisposing(true)
    const clientId = myLocked.id
    const result = await recordDisposition(clientId, status)
    if (!result.success) {
      alert(result.error)
      setDisposing(false)
      return
    }
    await fetchStats()
    if (status === 'reached') {
      router.push(`/queue/order/${clientId}`)
    } else {
      router.push(`/queue/whatsapp/${clientId}`)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Очередь звонков</h1>

      {/* Статистика дня */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{stats.calls}</div>
          <div className="text-sm text-muted-foreground">Звонков</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.reached}</div>
          <div className="text-sm text-muted-foreground">Дозвонов</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.orders}</div>
          <div className="text-sm text-muted-foreground">Заказов</div>
        </div>
      </div>

      {/* Мой активный звонок */}
      {myLocked && (
        <div className="mb-4 p-4 border rounded-lg bg-blue-50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-medium text-blue-800">Текущий звонок:</span>
              <span className="ml-2 font-semibold">{myLocked.name}</span>
              <span className="ml-2 text-muted-foreground">{myLocked.phone}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUnlock(myLocked.id)}
              disabled={locking === myLocked.id || disposing}
            >
              {locking === myLocked.id ? 'Отмена...' : 'Завершить'}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleDisposition('reached')}
              disabled={disposing}
            >
              {disposing ? '...' : 'Дозвонился'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleDisposition('not_reached')}
              disabled={disposing}
            >
              {disposing ? '...' : 'Не дозвонился'}
            </Button>
          </div>
        </div>
      )}

      {/* Фильтр */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-muted-foreground whitespace-nowrap">
          Минимум дней без заказа:
        </label>
        <Input
          type="number"
          min={1}
          value={minDays}
          onChange={(e) => setMinDays(Number(e.target.value) || 1)}
          className="w-24"
        />
      </div>

      {/* Таблица очереди */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Сегмент</TableHead>
              <TableHead className="text-right">Дней без заказа</TableHead>
              <TableHead className="text-right">Действие</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Нет клиентов в очереди
                </TableCell>
              </TableRow>
            ) : (
              clients.map((c) => (
                <TableRow key={c.id}>
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
                  <TableCell className="text-right">
                    {c.days_since_last_order != null ? `${c.days_since_last_order} дн.` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => handleLock(c.id)}
                      disabled={locking === c.id}
                    >
                      {locking === c.id ? '...' : 'Позвонить'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Обновляется автоматически. Лок истекает через 10 минут.
      </p>
    </div>
  )
}
