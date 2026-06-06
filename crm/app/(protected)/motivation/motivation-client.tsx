'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ManagerPerformance } from './actions'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const fmtPercent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

interface Props {
  initialData: ManagerPerformance
}

function calculateGrade(achievement: number): number {
  if (achievement < 0.7) return 0
  if (achievement < 0.85) return 0.5 + ((achievement - 0.7) / 0.15) * 0.5
  if (achievement < 1.0) return 1.0 + ((achievement - 0.85) / 0.15) * 0.5
  return 1.5
}

export function MotivationClient({ initialData }: Props) {
  const { today, month, kpi, categories, config } = initialData

  // Состояние слайдеров для калькулятора моделирования
  const [modelCarpets, setModelCarpets] = useState(categories.carpets)
  const [modelFurniture, setModelFurniture] = useState(categories.furniture)
  const [modelCurtains, setModelCurtains] = useState(categories.curtains)
  const [modelRepeat, setModelRepeat] = useState(categories.repeat)

  // Расчет значений моделирования
  const carpetsPlan = config.plans.carpets
  const furniturePlan = config.plans.furniture
  const curtainsPlan = config.plans.curtains
  const repeatPlan = config.plans.repeat

  const carpetsAch = carpetsPlan > 0 ? modelCarpets / carpetsPlan : 0
  const furnitureAch = furniturePlan > 0 ? modelFurniture / furniturePlan : 0
  const curtainsAch = curtainsPlan > 0 ? modelCurtains / curtainsPlan : 0
  const repeatAch = repeatPlan > 0 ? modelRepeat / repeatPlan : 0

  const carpetsGrade = calculateGrade(carpetsAch)
  const furnitureGrade = calculateGrade(furnitureAch)
  const curtainsGrade = calculateGrade(curtainsAch)
  const repeatGrade = calculateGrade(repeatAch)

  const carpetsEffRate = config.rates.carpets * carpetsGrade
  const furnitureEffRate = config.rates.furniture * furnitureGrade
  const curtainsEffRate = config.rates.curtains * curtainsGrade
  const repeatEffRate = config.rates.repeat * repeatGrade

  const carpetsBonus = modelCarpets * carpetsEffRate
  const furnitureBonus = modelFurniture * furnitureEffRate
  const curtainsBonus = modelCurtains * curtainsEffRate
  const repeatBonus = modelRepeat * repeatEffRate

  const totalModelRevenue = modelCarpets + modelFurniture + modelCurtains + modelRepeat
  const sumModelBonuses = carpetsBonus + furnitureBonus + curtainsBonus + repeatBonus

  // Джекпот: выполнение всех 4 категорий на 100%+
  const isJackpotEarned = carpetsAch >= 1.0 && furnitureAch >= 1.0 && curtainsAch >= 1.0 && repeatAch >= 1.0
  const jackpotAmount = isJackpotEarned ? config.jackpot : 0
  const totalModelPayout = sumModelBonuses + jackpotAmount

  // Сброс калькулятора к реальным показателям
  const handleReset = () => {
    setModelCarpets(categories.carpets)
    setModelFurniture(categories.furniture)
    setModelCurtains(categories.curtains)
    setModelRepeat(categories.repeat)
  }

  // Вспомогательная функция для генерации цвета грейда
  const getGradeBadgeColor = (grade: number) => {
    if (grade === 0) return 'bg-red-50 text-red-700 border-red-200'
    if (grade < 1.0) return 'bg-amber-50 text-amber-700 border-amber-200'
    if (grade < 1.5) return 'bg-blue-50 text-blue-700 border-blue-200'
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Моя мотивация</h1>
          <p className="text-muted-foreground text-sm">
            Панель показателей и калькулятор премий менеджера {config.managerName}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="px-3 py-1 bg-white text-[13px] border-[#ebe9e4] text-[#5c5950]">
            Роль: Менеджер
          </Badge>
          <Badge variant="outline" className="px-3 py-1 bg-white text-[13px] border-[#ebe9e4] text-[#5c5950]">
            Месяц: {new Date().toLocaleString('ru-RU', { month: 'long' })}
          </Badge>
        </div>
      </div>

      {/* Показатели Сегодня / Месяц */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* За сегодня */}
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-[16px] font-semibold text-foreground">Сегодня</CardTitle>
            <CardDescription>Показатели активности за день</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-[#1f2937]">{today.calls}</div>
              <div className="text-[11px] text-[#9b9892]">Звонков</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-blue-600">{today.reached}</div>
              <div className="text-[11px] text-[#9b9892]">Дозвонов</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-emerald-600">{today.orders}</div>
              <div className="text-[11px] text-[#9b9892]">Заказов</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-[#1f2937]">{fmtMoney.format(today.revenue)} ₸</div>
              <div className="text-[11px] text-[#9b9892]">Выручка</div>
            </div>
          </CardContent>
        </Card>

        {/* За месяц */}
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-[16px] font-semibold text-foreground">За текущий месяц</CardTitle>
            <CardDescription>Накопительные показатели за месяц</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-[#1f2937]">{month.calls}</div>
              <div className="text-[11px] text-[#9b9892]">Звонков</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-blue-600">{month.reached}</div>
              <div className="text-[11px] text-[#9b9892]">Дозвонов</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-emerald-600">{month.orders}</div>
              <div className="text-[11px] text-[#9b9892]">Заказов</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
              <div className="text-xl font-bold text-[#1f2937]">{fmtMoney.format(month.revenue)} ₸</div>
              <div className="text-[11px] text-[#9b9892]">Выручка</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Менеджера */}
      <h2 className="text-[15px] font-bold text-[#1f2937] pt-2 mb-2">Качество работы и KPI</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[#5c5950]">Конверсия</span>
              <span className="text-xs text-muted-foreground">Цель: 12%</span>
            </div>
            <div className="text-2xl font-bold mb-3">{fmtPercent.format(kpi.conversion)}%</div>
            <div className="w-full bg-[#f7f6f3] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, (kpi.conversion / 12) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[#5c5950]">Средний чек</span>
              <span className="text-xs text-muted-foreground">Цель: 17K ₸</span>
            </div>
            <div className="text-2xl font-bold mb-3">{fmtMoney.format(kpi.avgCheck)} ₸</div>
            <div className="w-full bg-[#f7f6f3] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-600 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, (kpi.avgCheck / 17000) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[#5c5950]">Доля кросс-продаж (2+ услуг)</span>
              <span className="text-xs text-muted-foreground">Цель: 20%</span>
            </div>
            <div className="text-2xl font-bold mb-3">{fmtPercent.format(kpi.crossSalesShare)}%</div>
            <div className="w-full bg-[#f7f6f3] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-sky-600 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, (kpi.crossSalesShare / 20) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Реальное выполнение планов */}
      <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-[16px] font-semibold text-foreground">
            Выполнение планов в текущем месяце (Факт)
          </CardTitle>
          <CardDescription>Фактическое распределение выручки по категориям из БД</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-[#ebe9e4]">
                <TableHead>Категория</TableHead>
                <TableHead className="text-right">План</TableHead>
                <TableHead className="text-right">Текущий факт</TableHead>
                <TableHead className="text-right">Выполнение</TableHead>
                <TableHead className="text-right">Коэффициент (грейд)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Ковры */}
              <TableRow className="border-[#ebe9e4]/60">
                <TableCell className="font-medium">Ковры (Новые)</TableCell>
                <TableCell className="text-right">{fmtMoney.format(carpetsPlan)} ₸</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney.format(categories.carpets)} ₸</TableCell>
                <TableCell className="text-right">
                  {carpetsPlan > 0 ? `${Math.round((categories.carpets / carpetsPlan) * 100)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={getGradeBadgeColor(calculateGrade(categories.carpets / carpetsPlan))}>
                    {fmtPercent.format(calculateGrade(categories.carpets / carpetsPlan))}x
                  </Badge>
                </TableCell>
              </TableRow>

              {/* Мебель */}
              <TableRow className="border-[#ebe9e4]/60">
                <TableCell className="font-medium">Мебель (Новые)</TableCell>
                <TableCell className="text-right">{fmtMoney.format(furniturePlan)} ₸</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney.format(categories.furniture)} ₸</TableCell>
                <TableCell className="text-right">
                  {furniturePlan > 0 ? `${Math.round((categories.furniture / furniturePlan) * 100)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={getGradeBadgeColor(calculateGrade(categories.furniture / furniturePlan))}>
                    {fmtPercent.format(calculateGrade(categories.furniture / furniturePlan))}x
                  </Badge>
                </TableCell>
              </TableRow>

              {/* Шторы */}
              <TableRow className="border-[#ebe9e4]/60">
                <TableCell className="font-medium">Шторы/тюли (Новые)</TableCell>
                <TableCell className="text-right">{fmtMoney.format(curtainsPlan)} ₸</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney.format(categories.curtains)} ₸</TableCell>
                <TableCell className="text-right">
                  {curtainsPlan > 0 ? `${Math.round((categories.curtains / curtainsPlan) * 100)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={getGradeBadgeColor(calculateGrade(categories.curtains / curtainsPlan))}>
                    {fmtPercent.format(calculateGrade(categories.curtains / curtainsPlan))}x
                  </Badge>
                </TableCell>
              </TableRow>

              {/* Повторные */}
              <TableRow className="border-transparent">
                <TableCell className="font-medium">Повторные клиенты</TableCell>
                <TableCell className="text-right">{fmtMoney.format(repeatPlan)} ₸</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney.format(categories.repeat)} ₸</TableCell>
                <TableCell className="text-right">
                  {repeatPlan > 0 ? `${Math.round((categories.repeat / repeatPlan) * 100)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={getGradeBadgeColor(calculateGrade(categories.repeat / repeatPlan))}>
                    {fmtPercent.format(calculateGrade(categories.repeat / repeatPlan))}x
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Интерактивный калькулятор моделирования */}
      <Card className="border-[#ebe9e4] bg-white shadow-md rounded-xl overflow-hidden">
        <div className="bg-[#f7f6f3] border-b border-[#ebe9e4] p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h3 className="text-[16px] font-bold text-foreground">Интерактивное моделирование премии</h3>
            <p className="text-xs text-muted-foreground">
              Перетаскивайте слайдеры для расчета бонусов при изменении выручки
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset} className="bg-white border-[#ebe9e4] text-[#5c5950]">
            Сбросить на реальный факт
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] divide-y lg:divide-y-0 lg:divide-x divide-[#ebe9e4]">
          {/* Слайдеры */}
          <div className="p-6 space-y-6">
            {/* Ковры */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Ковры (Новые)</span>
                <span className="text-[#5c5950]">
                  Факт: <span className="font-bold text-foreground">{fmtMoney.format(modelCarpets)}</span> / План: {fmtMoney.format(carpetsPlan)} ₸
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(carpetsPlan * 1.5, categories.carpets * 1.2, 500000)}
                step="5000"
                value={modelCarpets}
                onChange={(e) => setModelCarpets(Number(e.target.value))}
                className="w-full h-1.5 bg-[#f7f6f3] rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span className={carpetsAch >= 1.0 ? 'text-green-600 font-semibold' : ''}>
                  Выполнение: {fmtPercent.format(carpetsAch * 100)}%
                </span>
                <span>150%</span>
              </div>
            </div>

            {/* Мебель */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Мебель (Новые)</span>
                <span className="text-[#5c5950]">
                  Факт: <span className="font-bold text-foreground">{fmtMoney.format(modelFurniture)}</span> / План: {fmtMoney.format(furniturePlan)} ₸
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(furniturePlan * 1.5, categories.furniture * 1.2, 400000)}
                step="5000"
                value={modelFurniture}
                onChange={(e) => setModelFurniture(Number(e.target.value))}
                className="w-full h-1.5 bg-[#f7f6f3] rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span className={furnitureAch >= 1.0 ? 'text-green-600 font-semibold' : ''}>
                  Выполнение: {fmtPercent.format(furnitureAch * 100)}%
                </span>
                <span>150%</span>
              </div>
            </div>

            {/* Шторы */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Шторы/тюли (Новые)</span>
                <span className="text-[#5c5950]">
                  Факт: <span className="font-bold text-foreground">{fmtMoney.format(modelCurtains)}</span> / План: {fmtMoney.format(curtainsPlan)} ₸
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(curtainsPlan * 1.5, categories.curtains * 1.2, 300000)}
                step="5000"
                value={modelCurtains}
                onChange={(e) => setModelCurtains(Number(e.target.value))}
                className="w-full h-1.5 bg-[#f7f6f3] rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span className={curtainsAch >= 1.0 ? 'text-green-600 font-semibold' : ''}>
                  Выполнение: {fmtPercent.format(curtainsAch * 100)}%
                </span>
                <span>150%</span>
              </div>
            </div>

            {/* Повторные */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-blue-600">Повторные клиенты (Повышенный бонус)</span>
                <span className="text-[#5c5950]">
                  Факт: <span className="font-bold text-foreground">{fmtMoney.format(modelRepeat)}</span> / План: {fmtMoney.format(repeatPlan)} ₸
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(repeatPlan * 1.5, categories.repeat * 1.2, 400000)}
                step="5000"
                value={modelRepeat}
                onChange={(e) => setModelRepeat(Number(e.target.value))}
                className="w-full h-1.5 bg-[#f7f6f3] rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span className={repeatAch >= 1.0 ? 'text-green-600 font-semibold' : ''}>
                  Выполнение: {fmtPercent.format(repeatAch * 100)}%
                </span>
                <span>150%</span>
              </div>
            </div>
          </div>

          {/* Результаты расчета */}
          <div className="p-6 bg-[#fcfcfb] flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-bold text-sm text-[#1f2937] uppercase tracking-wider">Расчет премии</h4>
              
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#5c5950]">Ковры:</span>
                  <span className="font-medium">{fmtMoney.format(carpetsBonus)} ₸ <span className="text-xs text-muted-foreground">({fmtPercent.format(carpetsEffRate * 100)}%)</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5c5950]">Мебель:</span>
                  <span className="font-medium">{fmtMoney.format(furnitureBonus)} ₸ <span className="text-xs text-muted-foreground">({fmtPercent.format(furnitureEffRate * 100)}%)</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5c5950]">Шторы:</span>
                  <span className="font-medium">{fmtMoney.format(curtainsBonus)} ₸ <span className="text-xs text-muted-foreground">({fmtPercent.format(curtainsEffRate * 100)}%)</span></span>
                </div>
                <div className="flex justify-between text-blue-600 font-medium">
                  <span>Повторные:</span>
                  <span>{fmtMoney.format(repeatBonus)} ₸ <span className="text-xs text-blue-500">({fmtPercent.format(repeatEffRate * 100)}%)</span></span>
                </div>

                <div className="border-t border-[#ebe9e4] pt-2 flex justify-between font-semibold text-foreground">
                  <span>Бонусы по категориям:</span>
                  <span>{fmtMoney.format(sumModelBonuses)} ₸</span>
                </div>

                {/* Джекпот */}
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[#5c5950] flex items-center gap-1.5">
                    Джекпот-бонус:
                    {isJackpotEarned ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] px-1 py-0 h-4">
                        Выполнен
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-[#8a877e] border-[#e7e4dd]">
                        Нужно 100%+
                      </Badge>
                    )}
                  </span>
                  <span className={`font-semibold ${isJackpotEarned ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    +{fmtMoney.format(config.jackpot)} ₸
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-[#ebe9e4] mt-6">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Итого расчет премий:</div>
              <div className="text-3xl font-extrabold text-foreground">{fmtMoney.format(totalModelPayout)} ₸</div>
              <div className="text-xs text-[#9b9892] mt-1.5">
                При общей смоделированной выручке {fmtMoney.format(totalModelRevenue)} ₸
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
