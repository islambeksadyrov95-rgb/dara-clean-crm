'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { getMotivationStats, type ManagerPerformance } from './actions'
import { calculateGrade, computeBonus } from '@/lib/motivation-formula'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const fmtPercent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

const MONTHS = [
  { value: 1, label: 'Январь' },
  { value: 2, label: 'Февраль' },
  { value: 3, label: 'Март' },
  { value: 4, label: 'Апрель' },
  { value: 5, label: 'Май' },
  { value: 6, label: 'Июнь' },
  { value: 7, label: 'Июль' },
  { value: 8, label: 'Август' },
  { value: 9, label: 'Сентябрь' },
  { value: 10, label: 'Октябрь' },
  { value: 11, label: 'Ноябрь' },
  { value: 12, label: 'Декабрь' },
]

const YEARS = [2025, 2026, 2027, 2028]

interface Props {
  initialData: ManagerPerformance
}

export function MotivationClient({ initialData }: Props) {
  // Селекторы текущего месяца по умолчанию
  const now = new Date()
  const [month, setMonth] = useState<number>(now.getMonth() + 1)
  const [year, setYear] = useState<number>(now.getFullYear())
  const [data, setData] = useState<ManagerPerformance>(initialData)
  const [loading, setLoading] = useState(false)
  const isFirstRenderRef = useRef(true)

  const { today, month: monthStats, kpi, categories, config, fullPayout } = data

  // Состояние слайдеров для калькулятора моделирования
  const [modelCarpets, setModelCarpets] = useState(categories.carpets)
  const [modelFurniture, setModelFurniture] = useState(categories.furniture)
  const [modelCurtains, setModelCurtains] = useState(categories.curtains)
  const [modelDryClean, setModelDryClean] = useState(categories.dryClean)
  const [modelBlankets, setModelBlankets] = useState(categories.blankets)
  const [modelRepeat, setModelRepeat] = useState(categories.repeat)

  const [prevCategories, setPrevCategories] = useState(categories)

  if (categories !== prevCategories) {
    setPrevCategories(categories)
    setModelCarpets(categories.carpets)
    setModelFurniture(categories.furniture)
    setModelCurtains(categories.curtains)
    setModelDryClean(categories.dryClean)
    setModelBlankets(categories.blankets)
    setModelRepeat(categories.repeat)
  }

  // Загрузка статистики за выбранный месяц
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    async function load() {
      setLoading(true)
      try {
        const res = await getMotivationStats(month, year)
        setData(res)
      } catch (err: any) {
        toast.error(err.message || 'Ошибка загрузки данных')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [month, year])

  // Планы
  const carpetsPlan = config.plans.carpets
  const furniturePlan = config.plans.furniture
  const curtainsPlan = config.plans.curtains
  const repeatPlan = config.plans.repeat
  const dryCleanPlan = config.plans.dryClean
  const blanketsPlan = config.plans.blankets

  // Нормативы целей
  const targetConversion = config.targetConversion
  const targetAvgCheck = config.targetAvgCheck

  // Единый расчёт премии через общую формулу (та же, что в режиме админа)
  const model = computeBonus({
    revenue: {
      carpets: modelCarpets,
      furniture: modelFurniture,
      curtains: modelCurtains,
      repeat: modelRepeat,
      dryClean: modelDryClean,
      blankets: modelBlankets,
    },
    plans: config.plans,
    rates: config.rates,
    jackpot: config.jackpot,
  })

  const carpetsAch = model.categories.carpets.achievement
  const furnitureAch = model.categories.furniture.achievement
  const curtainsAch = model.categories.curtains.achievement
  const repeatAch = model.categories.repeat.achievement
  const dryCleanAch = model.categories.dryClean.achievement
  const blanketsAch = model.categories.blankets.achievement

  const carpetsEffRate = model.categories.carpets.effectiveRate
  const furnitureEffRate = model.categories.furniture.effectiveRate
  const curtainsEffRate = model.categories.curtains.effectiveRate
  const repeatEffRate = model.categories.repeat.effectiveRate
  const dryCleanEffRate = model.categories.dryClean.effectiveRate
  const blanketsEffRate = model.categories.blankets.effectiveRate

  const carpetsBonus = model.categories.carpets.bonus
  const furnitureBonus = model.categories.furniture.bonus
  const curtainsBonus = model.categories.curtains.bonus
  const repeatBonus = model.categories.repeat.bonus
  const dryCleanBonus = model.categories.dryClean.bonus
  const blanketsBonus = model.categories.blankets.bonus

  const totalModelRevenue = model.totalRevenue
  const sumModelBonuses = model.categoriesBonus

  const isJackpotEarned = model.isJackpotEarned
  const totalModelPayout = model.totalPayout
  const modelPercentOfRevenue = model.percentOfRevenue

  // Сброс калькулятора к реальным показателям
  const handleReset = () => {
    setModelCarpets(categories.carpets)
    setModelFurniture(categories.furniture)
    setModelCurtains(categories.curtains)
    setModelDryClean(categories.dryClean)
    setModelBlankets(categories.blankets)
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
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1 bg-white text-[13px] border-[#ebe9e4] text-[#5c5950] h-8">
            Роль: Менеджер
          </Badge>

          {/* Интерактивный селектор месяца и года */}
          <div className="flex items-center gap-2 bg-white border border-[#ebe9e4] p-1 rounded-lg shadow-2xs h-8">
            <Select value={String(month)} onValueChange={(val) => setMonth(Number(val))}>
              <SelectTrigger className="w-[110px] h-6 border-0 shadow-none focus:ring-0 text-xs px-2">
                <SelectValue placeholder="Месяц" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="w-px h-4 bg-[#ebe9e4]" />

            <Select value={String(year)} onValueChange={(val) => setYear(Number(val))}>
              <SelectTrigger className="w-[80px] h-6 border-0 shadow-none focus:ring-0 text-xs px-2">
                <SelectValue placeholder="Год" />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)} className="text-xs">
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Загрузка данных за {MONTHS.find(m => m.value === month)?.label} {year}...</span>
        </div>
      ) : (
        <>
          {/* Показатели Сегодня / Месяц */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* За сегодня */}
            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-[16px] font-semibold text-foreground">Сегодня</CardTitle>
                <CardDescription>Показатели активности за день (реальное время)</CardDescription>
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

            {/* За выбранный месяц */}
            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-[16px] font-semibold text-foreground">
                  За {MONTHS.find(m => m.value === month)?.label} {year}
                </CardTitle>
                <CardDescription>Накопительные показатели за выбранный период</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
                  <div className="text-xl font-bold text-[#1f2937]">{monthStats.calls}</div>
                  <div className="text-[11px] text-[#9b9892]">Звонков</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
                  <div className="text-xl font-bold text-blue-600">{monthStats.reached}</div>
                  <div className="text-[11px] text-[#9b9892]">Дозвонов</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
                  <div className="text-xl font-bold text-emerald-600">{monthStats.orders}</div>
                  <div className="text-[11px] text-[#9b9892]">Заказов</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-[#fcfcfb] border border-[#ebe9e4]/40">
                  <div className="text-xl font-bold text-[#1f2937]">{fmtMoney.format(monthStats.revenue)} ₸</div>
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
                  <span className="text-xs text-muted-foreground">Цель: {fmtPercent.format(targetConversion)}%</span>
                </div>
                <div className="text-2xl font-bold mb-3">{fmtPercent.format(kpi.conversion)}%</div>
                <div className="w-full bg-[#f7f6f3] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (kpi.conversion / targetConversion) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-[#5c5950]">Средний чек</span>
                  <span className="text-xs text-muted-foreground">Цель: {fmtMoney.format(targetAvgCheck)} ₸</span>
                </div>
                <div className="text-2xl font-bold mb-3">{fmtMoney.format(kpi.avgCheck)} ₸</div>
                <div className="w-full bg-[#f7f6f3] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (kpi.avgCheck / targetAvgCheck) * 100)}%` }}
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
                Выполнение планов в выбранном месяце (Факт)
              </CardTitle>
              <CardDescription>
                Фактическое распределение выручки по 6 категориям за {MONTHS.find(m => m.value === month)?.label} {year}
              </CardDescription>
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

                  {/* Самовывоз */}
                  <TableRow className="border-[#ebe9e4]/60">
                    <TableCell className="font-medium">Самовывоз</TableCell>
                    <TableCell className="text-right">{fmtMoney.format(dryCleanPlan)} ₸</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney.format(categories.dryClean)} ₸</TableCell>
                    <TableCell className="text-right">
                      {dryCleanPlan > 0 ? `${Math.round((categories.dryClean / dryCleanPlan) * 100)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={getGradeBadgeColor(calculateGrade(categories.dryClean / dryCleanPlan))}>
                        {fmtPercent.format(calculateGrade(categories.dryClean / dryCleanPlan))}x
                      </Badge>
                    </TableCell>
                  </TableRow>

                  {/* Пледы / Одеяла */}
                  <TableRow className="border-[#ebe9e4]/60">
                    <TableCell className="font-medium">Пледы / Одеяла</TableCell>
                    <TableCell className="text-right">{fmtMoney.format(blanketsPlan)} ₸</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney.format(categories.blankets)} ₸</TableCell>
                    <TableCell className="text-right">
                      {blanketsPlan > 0 ? `${Math.round((categories.blankets / blanketsPlan) * 100)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={getGradeBadgeColor(calculateGrade(categories.blankets / blanketsPlan))}>
                        {fmtPercent.format(calculateGrade(categories.blankets / blanketsPlan))}x
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
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl overflow-hidden">
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
                      Fact: <span className="font-bold text-foreground">{fmtMoney.format(modelCurtains)}</span> / План: {fmtMoney.format(curtainsPlan)} ₸
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

                {/* Самовывоз */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">Самовывоз</span>
                    <span className="text-[#5c5950]">
                      Факт: <span className="font-bold text-foreground">{fmtMoney.format(modelDryClean)}</span> / План: {fmtMoney.format(dryCleanPlan)} ₸
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(dryCleanPlan * 1.5, categories.dryClean * 1.2, 300000)}
                    step="5000"
                    value={modelDryClean}
                    onChange={(e) => setModelDryClean(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#f7f6f3] rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0%</span>
                    <span className={dryCleanAch >= 1.0 ? 'text-green-600 font-semibold' : ''}>
                      Выполнение: {fmtPercent.format(dryCleanAch * 100)}%
                    </span>
                    <span>150%</span>
                  </div>
                </div>

                {/* Пледы / Одеяла */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">Пледы / Одеяла</span>
                    <span className="text-[#5c5950]">
                      Факт: <span className="font-bold text-foreground">{fmtMoney.format(modelBlankets)}</span> / План: {fmtMoney.format(blanketsPlan)} ₸
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(blanketsPlan * 1.5, categories.blankets * 1.2, 300000)}
                    step="5000"
                    value={modelBlankets}
                    onChange={(e) => setModelBlankets(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#f7f6f3] rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0%</span>
                    <span className={blanketsAch >= 1.0 ? 'text-green-600 font-semibold' : ''}>
                      Выполнение: {fmtPercent.format(blanketsAch * 100)}%
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
                    <div className="flex justify-between">
                      <span className="text-[#5c5950]">Самовывоз:</span>
                      <span className="font-medium">{fmtMoney.format(dryCleanBonus)} ₸ <span className="text-xs text-muted-foreground">({fmtPercent.format(dryCleanEffRate * 100)}%)</span></span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#5c5950]">Пледы/Одеяла:</span>
                      <span className="font-medium">{fmtMoney.format(blanketsBonus)} ₸ <span className="text-xs text-muted-foreground">({fmtPercent.format(blanketsEffRate * 100)}%)</span></span>
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
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Премия по категориям + джекпот (модель):</div>
                  <div className="text-3xl font-extrabold text-foreground">{fmtMoney.format(totalModelPayout)} ₸</div>
                  <div className="text-sm font-bold text-primary mt-1">
                    Итого % премии от выручки: {fmtPercent.format(modelPercentOfRevenue)}%
                  </div>
                  <div className="text-xs text-[#9b9892] mt-1.5">
                    При общей смоделированной выручке {fmtMoney.format(totalModelRevenue)} ₸
                  </div>
                  <div className="text-[11px] text-[#9b9892] mt-2">
                    Без оклада и KPI-бонусов — полный итог ниже по реальному факту
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Полный итог к выплате по РЕАЛЬНОМУ факту (оклад + категории + джекпот + KPI) */}
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-[16px] font-semibold text-foreground">Итого к выплате (реальный факт)</CardTitle>
              <CardDescription>
                Полный расчёт зарплаты за {MONTHS.find((m) => m.value === month)?.label} {year} — оклад, премии и KPI-бонусы
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#5c5950]">Оклад:</span>
                  <span className="font-medium">{fmtMoney.format(fullPayout.salary)} ₸</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5c5950]">Бонусы по категориям:</span>
                  <span className="font-medium">{fmtMoney.format(fullPayout.categoriesBonus)} ₸</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#5c5950] flex items-center gap-1.5">
                    Джекпот:
                    {fullPayout.isJackpotEarned ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] px-1 py-0 h-4">Выполнен</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-[#8a877e] border-[#e7e4dd]">Не выполнен</Badge>
                    )}
                  </span>
                  <span className={`font-medium ${fullPayout.isJackpotEarned ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {fmtMoney.format(fullPayout.jackpotAmount)} ₸
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5c5950]">KPI-бонусы:</span>
                  <span className="font-medium">{fmtMoney.format(fullPayout.kpi.total)} ₸</span>
                </div>
              </div>

              {/* Детализация KPI-бонусов */}
              <div className="mt-4 pt-4 border-t border-[#ebe9e4]/60 space-y-2 text-sm">
                <div className="text-xs font-semibold text-[#5c5950] uppercase tracking-wider mb-1">KPI-бонусы по 25 000 ₸</div>
                <div className="flex justify-between items-center">
                  <span className="text-[#5c5950] flex items-center gap-1.5">
                    {fullPayout.kpi.isAvgCheckMet ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] px-1 py-0 h-4">Да</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-[#8a877e] border-[#e7e4dd]">Нет</Badge>
                    )}
                    Средний чек ≥ {fmtMoney.format(config.kpiAvgCheckTarget)} ₸
                    <span className="text-xs text-muted-foreground">(факт {fmtMoney.format(kpi.avgCheck)} ₸)</span>
                  </span>
                  <span className={`font-medium ${fullPayout.kpi.isAvgCheckMet ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {fmtMoney.format(fullPayout.kpi.avgCheckBonus)} ₸
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#5c5950] flex items-center gap-1.5">
                    {fullPayout.kpi.isCallConversionMet ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] px-1 py-0 h-4">Да</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-[#8a877e] border-[#e7e4dd]">Нет</Badge>
                    )}
                    Конверсия обзвона базы ≥ {fmtPercent.format(config.kpiCallConversionTarget * 100)}%
                    <span className="text-xs text-muted-foreground">
                      (факт {fmtPercent.format(monthStats.calls > 0 ? (monthStats.orders / monthStats.calls) * 100 : 0)}%)
                    </span>
                  </span>
                  <span className={`font-medium ${fullPayout.kpi.isCallConversionMet ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {fmtMoney.format(fullPayout.kpi.callConversionBonus)} ₸
                  </span>
                </div>
                <div className="text-xs text-[#9b9892] pt-1">
                  Конверсия обращение→заказ ≥ 55% — считается вне CRM (нет данных по обращениям)
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[#ebe9e4] flex items-center justify-between">
                <span className="text-sm font-semibold text-[#5c5950] uppercase tracking-wider">Итого к выплате</span>
                <span className="text-3xl font-extrabold text-foreground">{fmtMoney.format(fullPayout.grandTotal)} ₸</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
