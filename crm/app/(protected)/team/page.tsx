import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getTeamPerformance, ManagerLeaderboardItem } from './actions'

export const dynamic = 'force-dynamic'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const fmtPercent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Доступ только для администраторов
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/queue')
  }

  let teamPerformance: ManagerLeaderboardItem[] = []
  let errorMsg = ''

  try {
    teamPerformance = await getTeamPerformance()
  } catch (err: any) {
    errorMsg = err.message || 'Ошибка загрузки данных команды'
  }

  // Расчет общих показателей отдела за месяц
  const totalRevenue = teamPerformance.reduce((sum, item) => sum + item.month.revenue, 0)
  const totalCalls = teamPerformance.reduce((sum, item) => sum + item.month.calls, 0)
  const totalReached = teamPerformance.reduce((sum, item) => sum + item.month.reached, 0)
  const totalOrders = teamPerformance.reduce((sum, item) => sum + item.month.orders, 0)
  const avgConversion = totalReached > 0 ? (totalOrders / totalReached) * 100 : 0

  const getRankIndicator = (index: number) => {
    if (index === 0) return <span className="text-xl">🏆</span>
    if (index === 1) return <span className="text-xl">🥈</span>
    if (index === 2) return <span className="text-xl">🥉</span>
    return <span className="text-sm font-semibold text-[#8a877e] w-6 block text-center">#{index + 1}</span>
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Команда</h1>
        <p className="text-muted-foreground text-sm">
          Эффективность менеджеров отдела продаж, звонки и выполнение KPI
        </p>
      </div>

      {errorMsg ? (
        <Card className="border-red-200 bg-red-50 text-red-800 rounded-xl">
          <CardContent className="pt-6">
            <p className="font-semibold">Произошла ошибка:</p>
            <p className="text-sm">{errorMsg}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Общие показатели отдела */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardContent className="pt-6">
                <div className="text-xs font-semibold text-[#8a877e] uppercase tracking-wider mb-1">
                  Выручка отдела (Месяц)
                </div>
                <div className="text-2xl font-bold text-foreground">{fmtMoney.format(totalRevenue)} ₸</div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  Всего создано {totalOrders} заказов
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardContent className="pt-6">
                <div className="text-xs font-semibold text-[#8a877e] uppercase tracking-wider mb-1">
                  Звонки отдела (Месяц)
                </div>
                <div className="text-2xl font-bold text-foreground">{fmtMoney.format(totalCalls)}</div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  Дозвонились: {totalReached} ({totalCalls > 0 ? Math.round((totalReached / totalCalls) * 100) : 0}%)
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardContent className="pt-6">
                <div className="text-xs font-semibold text-[#8a877e] uppercase tracking-wider mb-1">
                  Средняя конверсия
                </div>
                <div className="text-2xl font-bold text-foreground">{fmtPercent.format(avgConversion)}%</div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  Из дозвона в созданный заказ
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
              <CardContent className="pt-6">
                <div className="text-xs font-semibold text-[#8a877e] uppercase tracking-wider mb-1">
                  Активных менеджеров
                </div>
                <div className="text-2xl font-bold text-foreground">{teamPerformance.length}</div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  С зарегистрированными аккаунтами
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Таблица лидеров и детальная статистика */}
          <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3 border-b border-[#ebe9e4]/60">
              <CardTitle className="text-[16px] font-semibold text-foreground">
                Рейтинг эффективности менеджеров
              </CardTitle>
              <CardDescription>
                Сортировка по сумме закрытых сделок (выручке) за текущий месяц
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-[#fcfcfb]">
                  <TableRow className="hover:bg-transparent border-[#ebe9e4]">
                    <TableHead className="w-14 text-center">Ранг</TableHead>
                    <TableHead>Менеджер</TableHead>
                    <TableHead className="text-right">Сегодня (звонки/дозвоны)</TableHead>
                    <TableHead className="text-right">Сегодня (выручка)</TableHead>
                    <TableHead className="text-right">Месяц (звонки/дозвоны)</TableHead>
                    <TableHead className="text-right">Конверсия</TableHead>
                    <TableHead className="text-right">Месяц (выручка)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamPerformance.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                        Менеджеры не найдены
                      </TableCell>
                    </TableRow>
                  ) : (
                    teamPerformance.map((item, index) => (
                      <TableRow key={item.managerId} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/50">
                        <TableCell className="text-center py-4">{getRankIndicator(index)}</TableCell>
                        <TableCell className="font-semibold text-foreground">
                          <div>{item.name}</div>
                          <div className="text-[11px] text-[#9b9892] font-normal">{item.email}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-medium text-[#1f2937]">{item.today.calls}</span>
                          <span className="text-[#9b9892] text-xs"> / {item.today.reached}</span>
                        </TableCell>
                        <TableCell className="text-right font-medium text-[#1f2937]">
                          {fmtMoney.format(item.today.revenue)} ₸
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-medium text-[#1f2937]">{item.month.calls}</span>
                          <span className="text-[#9b9892] text-xs"> / {item.month.reached}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="bg-[#f7f6f3] text-[#5c5950] border-[#ebe9e4]/60 text-xs">
                            {fmtPercent.format(item.month.conversion)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-600 text-[15px]">
                          {fmtMoney.format(item.month.revenue)} ₸
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
