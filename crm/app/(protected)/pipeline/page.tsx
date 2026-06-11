'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Lightbulb } from 'lucide-react'
import {
  getPipelineFunnel,
  getPipelineByManager,
  type PipelineFunnel,
  type ManagerFunnelRow,
} from './actions'

export const dynamic = 'force-dynamic'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

export default function PipelinePage() {
  const [data, setData] = useState<PipelineFunnel | null>(null)
  const [managers, setManagers] = useState<ManagerFunnelRow[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchPipelineData = useCallback(async () => {
    setLoading(true)
    try {
      const period = { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }
      const [funnel, byManager] = await Promise.all([
        getPipelineFunnel(period),
        getPipelineByManager(period),
      ])
      setData(funnel)
      setManagers(byManager)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
      toast.error(`Ошибка расчета воронки: ${message}`)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchPipelineData()
    })
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
          description: 'Всего клиентов в системе (за всё время)',
          href: '/clients',
          fillColor: 'bg-slate-500/10',
          barColor: 'bg-slate-500',
          conversionFromStart: 100,
          conversionFromPrev: 100,
        },
        {
          name: '2. С историей заказов',
          value: data.withOrderHistory,
          unit: 'клиентов',
          description: 'Клиенты с прошлыми заказами (за всё время)',
          href: '/clients',
          fillColor: 'bg-blue-500/10',
          barColor: 'bg-blue-500',
          conversionFromStart: getPercent(data.withOrderHistory, data.totalClients),
          conversionFromPrev: getPercent(data.withOrderHistory, data.totalClients),
        },
        {
          name: '3. Обзвонено',
          value: data.called,
          unit: 'клиентов',
          description: `Совершено ${data.totalCallsCount} звонков менеджерами`,
          href: '/calls',
          fillColor: 'bg-amber-500/10',
          barColor: 'bg-amber-500',
          conversionFromStart: getPercent(data.called, data.totalClients),
          conversionFromPrev: getPercent(data.called, data.withOrderHistory),
        },
        {
          name: '4. Дозвонились',
          value: data.reached,
          unit: 'клиентов',
          description: `${data.reachedCallsCount} успешных разговоров (${getPercent(data.reachedCallsCount, data.totalCallsCount)}% от звонков)`,
          href: '/calls',
          fillColor: 'bg-indigo-500/10',
          barColor: 'bg-indigo-500',
          conversionFromStart: getPercent(data.reached, data.totalClients),
          conversionFromPrev: getPercent(data.reached, data.called),
        },
        {
          name: '5. Оформлен заказ',
          value: data.ordered,
          unit: 'клиентов',
          description: `Создано ${data.totalOrdersCount} заказов на сумму ${fmtMoney.format(data.totalRevenue)} ₸`,
          href: '/orders',
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
        <span className="text-[11px] text-[#a8a49a] ml-auto self-center">
          «База» и «С историей заказов» — за всё время. Звонки и заказы — за выбранный период.
        </span>
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
                        <Link href={step.href} className="font-semibold text-foreground hover:text-[#2563eb] hover:underline transition-colors">
                          {step.name}
                        </Link>
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

            {/* Разрез по менеджерам */}
            <Card className="p-6 border-[#ebe9e4]">
              <h2 className="text-sm font-semibold text-[#5c5950] mb-4">По менеджерам (за период)</h2>
              {managers.length === 0 ? (
                <p className="text-xs text-[#8a877e] py-4">Нет активности менеджеров за выбранный период.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#8a877e] border-b border-[#ebe9e4]">
                        <th className="py-2 pr-3 font-semibold">Менеджер</th>
                        <th className="py-2 px-3 font-semibold text-right">Звонки</th>
                        <th className="py-2 px-3 font-semibold text-right">Дозвоны</th>
                        <th className="py-2 px-3 font-semibold text-right">Заказы</th>
                        <th className="py-2 pl-3 font-semibold text-right">Конверсия</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {managers.map((m) => (
                        <tr key={m.managerId} className="border-b border-[#f2f1ed] last:border-0">
                          <td className="py-2 pr-3 font-sans font-medium text-foreground">{m.name}</td>
                          <td className="py-2 px-3 text-right text-[#5c5950]">{m.calls}</td>
                          <td className="py-2 px-3 text-right text-indigo-600">{m.reached}</td>
                          <td className="py-2 px-3 text-right text-emerald-600">{m.orders}</td>
                          <td className="py-2 pl-3 text-right font-semibold text-foreground">{m.conversion}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
                    <div className="text-xs text-[#8a877e] mb-0.5">Конверсия (Дозвон → Заказ)</div>
                    <div className="text-lg font-bold font-mono text-emerald-600">
                      {getPercent(data.ordered, data.reached)}%
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
