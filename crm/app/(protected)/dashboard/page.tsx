'use client'

import { useEffect, useState } from 'react'
import { getTeamStats, getTotalClients } from './actions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

const SEGMENT_COLORS: Record<string, string> = {
  'Новый': 'bg-blue-100 text-blue-800',
  'Повторный': 'bg-green-100 text-green-800',
  'Постоянный': 'bg-emerald-100 text-emerald-800',
  'В риске': 'bg-yellow-100 text-yellow-800',
  'Потерянный': 'bg-red-100 text-red-800',
}

type ManagerStats = {
  manager_id: string
  email: string
  calls: number
  reached: number
  orders: number
  revenue: number
}

type ClientsInfo = { total: number; segments: Record<string, number> }

export default function DashboardPage() {
  const [team, setTeam] = useState<ManagerStats[]>([])
  const [clientsInfo, setClientsInfo] = useState<ClientsInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getTeamStats(), getTotalClients()]).then(([t, c]) => {
      setTeam(t)
      setClientsInfo(c)
      setLoading(false)
    })
  }, [])

  const totalCalls = team.reduce((s, m) => s + m.calls, 0)
  const totalReached = team.reduce((s, m) => s + m.reached, 0)
  const totalOrders = team.reduce((s, m) => s + m.orders, 0)
  const totalRevenue = team.reduce((s, m) => s + m.revenue, 0)

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground">Загрузка...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Сводка за сегодня</h1>

      {/* Общие показатели */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold">{totalCalls}</div>
          <div className="text-sm text-muted-foreground">Звонков</div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{totalReached}</div>
          <div className="text-sm text-muted-foreground">Дозвонов</div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{totalOrders}</div>
          <div className="text-sm text-muted-foreground">Заказов</div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold">{fmtMoney.format(totalRevenue)} ₸</div>
          <div className="text-sm text-muted-foreground">Выручка</div>
        </div>
      </div>

      {/* Менеджеры */}
      <h2 className="text-lg font-semibold mb-3">Менеджеры</h2>
      <div className="border rounded-lg mb-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead className="text-right">Звонков</TableHead>
              <TableHead className="text-right">Дозвонов</TableHead>
              <TableHead className="text-right">Конверсия</TableHead>
              <TableHead className="text-right">Заказов</TableHead>
              <TableHead className="text-right">Выручка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                  Нет данных за сегодня
                </TableCell>
              </TableRow>
            ) : (
              team.map((m) => (
                <TableRow key={m.manager_id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell className="text-right">{m.calls}</TableCell>
                  <TableCell className="text-right">{m.reached}</TableCell>
                  <TableCell className="text-right">
                    {m.calls > 0 ? `${Math.round((m.reached / m.calls) * 100)}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right">{m.orders}</TableCell>
                  <TableCell className="text-right">{fmtMoney.format(m.revenue)} ₸</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Клиентская база */}
      {clientsInfo && (
        <>
          <h2 className="text-lg font-semibold mb-3">
            Клиентская база ({fmtMoney.format(clientsInfo.total)})
          </h2>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(clientsInfo.segments).map(([seg, count]) => (
              <div key={seg} className="border rounded-lg px-4 py-2 flex items-center gap-2">
                <Badge variant="outline" className={SEGMENT_COLORS[seg] ?? ''}>
                  {seg}
                </Badge>
                <span className="font-medium">{fmtMoney.format(count)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
