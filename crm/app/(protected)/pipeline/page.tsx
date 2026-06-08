'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Lightbulb } from 'lucide-react'

export const dynamic = 'force-dynamic'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

type FunnelData = {
  totalClients: number
  inQueue: number
  called: number
  reached: number
  ordered: number
  totalRevenue: number
  avgCheck: number
  totalCallsCount: number
  reachedCallsCount: number
  totalOrdersCount: number
}

export default function PipelinePage() {
  const supabase = createClient()

  const [data, setData] = useState<FunnelData | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchPipelineData = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Запрос клиентов (всего)
      let clientsQuery = supabase.from('clients').select('id, created_at, last_order_date')
      if (dateFrom) {
        clientsQuery = clientsQuery.gte('created_at', new Date(dateFrom).toISOString())
      }
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        clientsQuery = clientsQuery.lte('created_at', end.toISOString())
      }
      const { data: clients, error: clientsError } = await clientsQuery
      if (clientsError) throw clientsError

      const totalClients = clients?.length ?? 0

      // В очереди: клиенты, у которых есть история заказов (last_order_date не null)
      // Если фильтр по дате включен, берем тех, у кого дата заказа попадает в период
      const inQueue = clients?.filter(c => {
        if (!c.last_order_date) return false
        if (dateFrom) {
          const orderTime = new Date(c.last_order_date).getTime()
          const fromTime = new Date(dateFrom).getTime()
          if (orderTime < fromTime) return false
        }
        if (dateTo) {
          const orderTime = new Date(c.last_order_date).getTime()
          const toTime = new Date(dateTo).setHours(23, 59, 59, 999)
          if (orderTime > toTime) return false
        }
        return true
      }).length ?? 0

      // 2. Запрос звонков
      let callsQuery = supabase.from('call_logs').select('client_id, status, created_at')
      if (dateFrom) {
        callsQuery = callsQuery.gte('created_at', new Date(dateFrom).toISOString())
      }
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        callsQuery = callsQuery.lte('created_at', end.toISOString())
      }
      const { data: calls, error: callsError } = await callsQuery
      if (callsError) throw callsError

      const totalCallsCount = calls?.length ?? 0
      const reachedCallsCount = calls?.filter(c => c.status === 'reached').length ?? 0

      // Уникальные обзвоненные клиенты
      const calledClientsSet = new Set(calls?.map(c => c.client_id))
      const called = calledClientsSet.size

      // Уникальные клиенты, до которых дозвонились
      const reachedClientsSet = new Set(calls?.filter(c => c.status === 'reached').map(c => c.client_id))
      const reached = reachedClientsSet.size

      // 3. Запрос заказов
      let ordersQuery = supabase.from('orders').select('client_id, amount, created_at')
      if (dateFrom) {
        ordersQuery = ordersQuery.gte('created_at', new Date(dateFrom).toISOString())
      }
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        ordersQuery = ordersQuery.lte('created_at', end.toISOString())
      }
      const { data: orders, error: ordersError } = await ordersQuery
      if (ordersError) throw ordersError

      const totalOrdersCount = orders?.length ?? 0
      const totalRevenue = orders?.reduce((sum, o) => sum + Number(o.amount || 0), 0) ?? 0
      const avgCheck = totalOrdersCount > 0 ? Math.round(totalRevenue / totalOrdersCount) : 0

      // Уникальные клиенты с заказами
      const orderedClientsSet = new Set(orders?.map(o => o.client_id))
      const ordered = orderedClientsSet.size

      setData({
        totalClients,
        inQueue,
        called,
        reached,
        ordered,
        totalRevenue,
        avgCheck,
        totalCallsCount,
        reachedCallsCount,
        totalOrdersCount,
      })
    } catch (error: any) {
      toast.error(`Ошибка расчета воронки: ${error.message || 'Неизвестная ошибка'}`)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, supabase])

  useEffect(() => {
    fetchPipelineData()
  }, [fetchPipelineData])

  // Расчет конверсий
  const getPercent = (value: number, total: number) => {
    if (total === 0) return 0
    return Math.round((value / total) * 100)
  }

  // Определение этапов воронки
  const funnelSteps = data
    ? [
        {
          name: '1. База клиентов',
          value: data.totalClients,
          unit: 'клиентов',
          description: 'Всего зарегистрировано в системе за период',
          color: 'bg-slate-100 text-slate-800 border-slate-200',
          fillColor: 'bg-slate-500/10',
          barColor: 'bg-slate-500',
          conversionFromStart: 100,
          conversionFromPrev: 100,
        },
        {
          name: '2. В очереди на обзвон',
          value: data.inQueue,
          unit: 'клиентов',
          description: 'Клиенты с историей заказов для повторного контакта',
          color: 'bg-blue-50 text-blue-700 border-blue-100',
          fillColor: 'bg-blue-500/10',
          barColor: 'bg-blue-500',
          conversionFromStart: getPercent(data.inQueue, data.totalClients),
          conversionFromPrev: getPercent(data.inQueue, data.totalClients),
        },
        {
          name: '3. Попытки связи (Обзвонено)',
          value: data.called,
          unit: 'клиентов',
          description: `Совершено ${data.totalCallsCount} звонков менеджерами`,
          color: 'bg-amber-50 text-amber-700 border-amber-100',
          fillColor: 'bg-amber-500/10',
          barColor: 'bg-amber-500',
          conversionFromStart: getPercent(data.called, data.totalClients),
          conversionFromPrev: getPercent(data.called, data.inQueue),
        },
        {
          name: '4. Успешный контакт (Дозвонились)',
          value: data.reached,
          unit: 'клиентов',
          description: `${data.reachedCallsCount} успешных разговоров (${getPercent(data.reachedCallsCount, data.totalCallsCount)}% от звонков)`,
          color: 'bg-indigo-50 text-indigo-700 border-indigo-100',
          fillColor: 'bg-indigo-500/10',
          barColor: 'bg-indigo-500',
          conversionFromStart: getPercent(data.reached, data.totalClients),
          conversionFromPrev: getPercent(data.reached, data.called),
        },
        {
          name: '5. Оформлен заказ (Покупка)',
          value: data.ordered,
          unit: 'клиентов',
          description: `Создано ${data.totalOrdersCount} заказов на сумму ${fmtMoney.format(data.totalRevenue)} ₸`,
          color: 'bg-emerald-50 text-emerald-700 border-emerald-100',
          fillColor: 'bg-emerald-500/10',
          barColor: 'bg-emerald-500',
          conversionFromStart: getPercent(data.ordered, data.totalClients),
          conversionFromPrev: getPercent(data.ordered, data.reached),
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Воронка продаж</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchPipelineData}
          className="text-xs"
          disabled={loading}
        >
          {loading ? 'Обновление...' : 'Обновить данные'}
        </Button>
      </div>

      {/* Фильтры по дате */}
      <div className="flex flex-wrap gap-4 items-end rounded-xl border bg-card p-4 shadow-sm">
        <div>
          <label htmlFor="pipeline-date-from" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
            Период с
          </label>
          <Input
            id="pipeline-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-[#fcfcfb] w-[160px]"
          />
        </div>
        <div>
          <label htmlFor="pipeline-date-to" className="text-xs font-semibold text-[#8a877e] mb-1.5 block">
            Период по
          </label>
          <Input
            id="pipeline-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-[#fcfcfb] w-[160px]"
          />
        </div>

        {(dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateFrom('')
              setDateTo('')
            }}
            className="text-xs text-[#5c5950] hover:text-foreground h-9 px-3"
          >
            Сбросить даты
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="text-sm text-[#8a877e]">Расчет показателей воронки...</span>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Визуализация воронки */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-6 border-[#ebe9e4]">
              <h2 className="text-sm font-semibold text-[#5c5950] mb-6">Конверсия по этапам</h2>
              
              <div className="space-y-4">
                {funnelSteps.map((step, idx) => {
                  // Вычисляем ширину прогресс-бара пропорционально первому шагу
                  const widthPercent = idx === 0 
                    ? 100 
                    : Math.max((step.value / (data.totalClients || 1)) * 100, 3) // Минимальная видимая ширина

                  return (
                    <div key={step.name} className="space-y-1.5 group">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground">{step.name}</span>
                        <div className="flex items-center gap-3 font-mono text-[#5c5950]">
                          <span className="font-bold text-foreground">
                            {step.value} {step.unit}
                          </span>
                          {idx > 0 && (
                            <span className="text-xs text-muted-foreground" title="Конверсия от предыдущего этапа">
                              ({step.conversionFromPrev}% от пред.)
                            </span>
                          )}
                          {idx > 0 && (
                            <span className="text-xs font-semibold text-[#2563eb]" title="Сквозная конверсия от начала воронки">
                              {step.conversionFromStart}% от базы
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Тонкий красивый прогресс-бар */}
                      <div className="h-6 w-full rounded-lg bg-muted/40 overflow-hidden relative border border-border/10 flex items-center px-2">
                        <div
                          className={`absolute left-0 top-0 bottom-0 ${step.fillColor} transition-all duration-500`}
                          style={{ width: `${widthPercent}%` }}
                        />
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-1 ${step.barColor}`}
                        />
                        <span className="relative z-10 text-[11px] text-[#8a877e] font-normal truncate">
                          {step.description}
                        </span>
                      </div>

                      {/* Стрелочка перехода между этапами */}
                      {idx < funnelSteps.length - 1 && (
                        <div className="flex justify-center py-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#8a877e] bg-muted/30 px-2 py-0.5 rounded-full border border-border/30">
                            <span>↓ Переход: {funnelSteps[idx + 1].conversionFromPrev}%</span>
                            <span className="text-red-500 font-normal">
                              (потери {100 - funnelSteps[idx + 1].conversionFromPrev}%)
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          {/* Финансовые и аналитические карточки */}
          <div className="space-y-6">
            <Card className="p-6 border-[#ebe9e4] space-y-6">
              <div>
                <h2 className="text-sm font-semibold text-[#5c5950] mb-4">Бизнес-показатели</h2>
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-[#8a877e] mb-0.5">Выручка по воронке</div>
                    <div className="text-2xl font-bold font-mono text-foreground">
                      {fmtMoney.format(data.totalRevenue)} ₸
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#8a877e] mb-0.5">Средний чек</div>
                    <div className="text-lg font-bold font-mono text-[#5c5950]">
                      {fmtMoney.format(data.avgCheck)} ₸
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#8a877e] mb-0.5">Сквозная конверсия (База → Заказ)</div>
                    <div className="text-lg font-bold font-mono text-emerald-600">
                      {getPercent(data.ordered, data.totalClients)}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#ebe9e4] pt-4">
                <h3 className="text-xs font-semibold text-[#5c5950] mb-3 uppercase tracking-wider">
                  Эффективность звонков
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] text-[#8a877e]">Всего звонков</div>
                    <div className="text-base font-bold font-mono text-foreground">
                      {data.totalCallsCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#8a877e]">Дозвонились</div>
                    <div className="text-base font-bold font-mono text-indigo-600">
                      {data.reachedCallsCount}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[11px] text-[#8a877e] mb-1">Дозвон (Reach Rate)</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${getPercent(data.reachedCallsCount, data.totalCallsCount)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold font-mono">
                        {getPercent(data.reachedCallsCount, data.totalCallsCount)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4 border-[#ebe9e4] bg-[#f7f6f3]/40">
              <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-amber-500" /> Совет по воронке
              </h3>
              <p className="text-xs text-[#5c5950] leading-relaxed">
                Основная точка роста — переход от <span className="font-semibold text-amber-700">попыток связи</span> к{' '}
                <span className="font-semibold text-indigo-700">успешным контактам</span>. Повышайте Reach Rate, оптимизируя время звонков, и отправляйте WhatsApp в случае недозвона.
              </p>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
