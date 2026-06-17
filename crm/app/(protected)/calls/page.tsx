'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { getCommunications, type CommunicationEntry } from './actions'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { STATUS_LABELS, SUB_STATUS_LABELS } from '@/lib/call-status'

const STATUS_COLORS: Record<string, string> = {
  reached: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  not_reached: 'bg-muted text-muted-foreground',
  callback: 'bg-amber-50 text-amber-700 border-amber-100',
  declined: 'bg-red-50 text-red-700 border-red-100',
  not_relevant: 'bg-muted text-muted-foreground',
  order: 'bg-blue-50 text-blue-700 border-blue-100',
}

const TYPE_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'call', label: 'Звонки' },
  { value: 'order', label: 'Заказы' },
]

const STATUS_FILTERS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'reached', label: 'Дозвонился' },
  { value: 'not_reached', label: 'Не дозвонился' },
  { value: 'callback', label: 'Перезвонить' },
  { value: 'declined', label: 'Отказ' },
]

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Today's date in YYYY-MM-DD using Almaty timezone (UTC+5). */
function todayAlmaty() {
  const now = new Date()
  // Offset to UTC+5
  const almatyMs = now.getTime() + 5 * 60 * 60 * 1000
  const d = new Date(almatyMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

type DatePreset = 'today' | 'week' | 'month'

function presetDates(preset: DatePreset): { from: string; to: string } {
  const today = todayAlmaty()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') return { from: addDays(today, -6), to: today }
  return { from: addDays(today, -29), to: today }
}

const PAGE_SIZE = 50

export default function CommunicationsPage() {
  const [logs, setLogs] = useState<CommunicationEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<DatePreset>('today')
  const [dateFrom, setDateFrom] = useState(() => todayAlmaty())
  const [dateTo, setDateTo] = useState(() => todayAlmaty())
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')

  const applyPreset = useCallback((p: DatePreset) => {
    const { from, to } = presetDates(p)
    setPreset(p)
    setDateFrom(from)
    setDateTo(to)
    setOffset(0)
    setLogs([])
  }, [])

  // Initial load & filter changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    getCommunications({ dateFrom, dateTo, status, type, offset: 0 })
      .then((res) => {
        setLogs(res.entries)
        setTotal(res.total)
        setOffset(res.entries.length)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки данных')
      })
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, status, type])

  const loadMore = useCallback(() => {
    setLoadingMore(true)
    setError(null)
    getCommunications({ dateFrom, dateTo, status, type, offset })
      .then((res) => {
        setLogs((prev) => [...prev, ...res.entries])
        setOffset((prev) => prev + res.entries.length)
        setTotal(res.total)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки данных')
      })
      .finally(() => setLoadingMore(false))
  }, [dateFrom, dateTo, status, type, offset])

  const hasMore = logs.length < total

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Журнал коммуникаций</h1>

      {/* Фильтры */}
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        {/* Пресеты дат */}
        <div className="flex gap-1">
          {([
            { value: 'today', label: 'Сегодня' },
            { value: 'week', label: 'Неделя' },
            { value: 'month', label: 'Месяц' },
          ] as { value: DatePreset; label: string }[]).map((p) => (
            <button
              key={p.value}
              onClick={() => applyPreset(p.value)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${preset === p.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-muted'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Ручной диапазон */}
        <div>
          <label htmlFor="dateFrom" className="text-xs text-muted-foreground block mb-1">С</label>
          <Input
            id="dateFrom"
            type="date"
            value={dateFrom}
            onChange={(e) => { setPreset('today' as DatePreset); setDateFrom(e.target.value); setOffset(0); setLogs([]) }}
            className="w-40"
          />
        </div>
        <div>
          <label htmlFor="dateTo" className="text-xs text-muted-foreground block mb-1">По</label>
          <Input
            id="dateTo"
            type="date"
            value={dateTo}
            onChange={(e) => { setPreset('today' as DatePreset); setDateTo(e.target.value); setOffset(0); setLogs([]) }}
            className="w-40"
          />
        </div>

        <div className="flex gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.value}
              onClick={() => { setType(t.value); setOffset(0); setLogs([]) }}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${type === t.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => { setStatus(s.value); setOffset(0); setLogs([]) }}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${status === s.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-muted'}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="text-sm text-muted-foreground ml-auto">
          {loading ? 'Загрузка...' : `${total} записей, показано ${logs.length}`}
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Таблица */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Время</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Результат</TableHead>
              <TableHead>Детали</TableHead>
              <TableHead>Менеджер</TableHead>
              <TableHead>Заметка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Загрузка...</TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Нет записей за выбранный период</TableCell>
              </TableRow>
            ) : logs.map((log) => (
              <TableRow key={`${log.type}-${log.id}`}>
                <TableCell className="text-sm whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={log.type === 'order' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'}>
                    {log.type === 'order' ? 'Заказ' : 'Звонок'}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">
                  {log.clientId ? (
                    <Link href={`/clients/${log.clientId}`} prefetch={false} className="hover:underline text-foreground">
                      {log.clientName}
                    </Link>
                  ) : log.clientName}
                </TableCell>
                <TableCell>
                  <a href={`tel:${log.clientPhone}`} className="hover:underline text-sm">{log.clientPhone}</a>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_COLORS[log.status] ?? ''}>
                    {STATUS_LABELS[log.status] ?? log.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {log.type === 'order' && log.amount
                    ? `${log.subStatus} — ${fmtMoney.format(log.amount)} ₸`
                    : log.subStatus ? (SUB_STATUS_LABELS[log.subStatus] ?? log.subStatus) : '—'}
                  {log.reason && <span className="ml-1">({log.reason})</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{log.managerEmail}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{log.notes ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Пагинация */}
      {hasMore && !loading && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 text-sm rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {loadingMore ? 'Загрузка...' : `Показать ещё (ещё ${total - logs.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
