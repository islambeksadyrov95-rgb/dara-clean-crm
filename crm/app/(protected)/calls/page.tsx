'use client'

import { useEffect, useState } from 'react'
import { getCommunications, type CommunicationEntry } from './actions'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const STATUS_LABELS: Record<string, string> = {
  reached: 'Дозвонился', not_reached: 'Не дозвонился',
  callback: 'Перезвонить', declined: 'Отказ', not_relevant: 'Не актуально',
  order: 'Заказ',
}

const SUB_STATUS_LABELS: Record<string, string> = {
  ordered: 'Заказ', callback_later: 'Перезвон', sent_whatsapp: 'WhatsApp',
  decline_expensive: 'Дорого', decline_competitor: 'Другая компания',
  decline_not_needed: 'Не нужно', decline_quality: 'Качество',
  decline_season: 'Не сезон', decline_other: 'Другое',
  wrong_number: 'Неверный номер', unavailable: 'Недоступен',
  blocked: 'Заблокировал', auto_3_strikes: '3 попытки',
}

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

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CommunicationsPage() {
  const [logs, setLogs] = useState<CommunicationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')

  useEffect(() => {
    setLoading(true)
    getCommunications({ dateFrom, dateTo, status, type }).then((data) => {
      setLogs(data)
      setLoading(false)
    })
  }, [dateFrom, dateTo, status, type])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Журнал коммуникаций</h1>

      {/* Фильтры */}
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div>
          <label htmlFor="dateFrom" className="text-xs text-muted-foreground block mb-1">С</label>
          <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label htmlFor="dateTo" className="text-xs text-muted-foreground block mb-1">По</label>
          <Input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div className="flex gap-1">
          {TYPE_FILTERS.map((t) => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${type === t.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-muted'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => (
            <button key={s.value} onClick={() => setStatus(s.value)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${status === s.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-muted'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="text-sm text-muted-foreground ml-auto">{logs.length} записей</div>
      </div>

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
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Загрузка...</TableCell></TableRow>
            ) : logs.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Нет записей за выбранный период</TableCell></TableRow>
            ) : logs.map((log) => (
              <TableRow key={`${log.type}-${log.id}`}>
                <TableCell className="text-sm whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={log.type === 'order' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'}>
                    {log.type === 'order' ? 'Заказ' : 'Звонок'}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{log.clientName}</TableCell>
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
    </div>
  )
}
