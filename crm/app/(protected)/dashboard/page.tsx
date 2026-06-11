import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getDashboardData, type DashboardData } from './actions'

export const dynamic = 'force-dynamic'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-red-200 bg-red-50 text-red-800 rounded-xl">
      <CardContent className="pt-6">
        <p className="font-semibold">Произошла ошибка</p>
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Доступ только для администраторов (server-side gate).
  if (!user || getUserRole(user) !== 'admin') {
    redirect('/queue')
  }

  let data: DashboardData | null = null
  let errorMsg = ''
  try {
    data = await getDashboardData()
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'Ошибка загрузки дашборда'
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Дашборд руководителя</h1>
        <p className="text-muted-foreground text-sm">
          Сегодня, план месяца, воронка и качество звонков — на одном экране
        </p>
      </div>

      {errorMsg ? (
        <ErrorCard message={errorMsg} />
      ) : !data ? (
        <ErrorCard message="Нет данных" />
      ) : (
        <>
          <TodaySection today={data.today} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PlanFactSection planFact={data.planFact} />
            <FunnelSection funnel={data.funnel} />
          </div>
          <QualitySection calls={data.lowScoreCalls} />
        </>
      )}
    </div>
  )
}

// ─── 1. Сегодня по менеджерам ───
function TodaySection({ today }: { today: DashboardData['today'] }) {
  return (
    <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-[#ebe9e4]/60">
        <CardTitle className="text-[16px] font-semibold text-foreground">Сегодня</CardTitle>
        <CardDescription>Звонки, дозвоны, заказы и выручка по менеджерам за сегодня</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-[#fcfcfb]">
            <TableRow className="hover:bg-transparent border-[#ebe9e4]">
              <TableHead>Менеджер</TableHead>
              <TableHead className="text-right">Звонки</TableHead>
              <TableHead className="text-right">Дозвоны</TableHead>
              <TableHead className="text-right">WhatsApp</TableHead>
              <TableHead className="text-right">Заказы</TableHead>
              <TableHead className="text-right">Выручка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {today.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                  Менеджеры не найдены
                </TableCell>
              </TableRow>
            ) : (
              today.map((m) => (
                <TableRow key={m.managerId} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/50">
                  <TableCell className="font-semibold text-foreground">
                    <div>{m.name}</div>
                    <div className="text-[11px] text-[#9b9892] font-normal">{m.email}</div>
                  </TableCell>
                  <TableCell className="text-right font-medium text-[#1f2937]">{m.calls}</TableCell>
                  <TableCell className="text-right text-[#1f2937]">{m.reached}</TableCell>
                  <TableCell className="text-right text-[#9b9892]">{m.whatsapp}</TableCell>
                  <TableCell className="text-right text-[#1f2937]">{m.orders}</TableCell>
                  <TableCell className="text-right font-bold text-emerald-600">
                    {fmtMoney.format(m.revenue)} ₸
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ─── 2. План-факт месяца + прогноз ───
function PlanFactSection({ planFact }: { planFact: DashboardData['planFact'] }) {
  const { monthRevenue, monthPlan, planPercent, hasEnoughData, forecastPercent } = planFact

  return (
    <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-[#ebe9e4]/60">
        <CardTitle className="text-[16px] font-semibold text-foreground">План месяца</CardTitle>
        <CardDescription>Выручка отдела против плана, с прогнозом по текущему темпу</CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-[#8a877e] uppercase tracking-wider mb-1">Факт</div>
            <div className="text-2xl font-bold text-foreground">{fmtMoney.format(monthRevenue)} ₸</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-[#8a877e] uppercase tracking-wider mb-1">План</div>
            <div className="text-lg font-semibold text-[#5c5950]">
              {monthPlan > 0 ? `${fmtMoney.format(monthPlan)} ₸` : 'не задан'}
            </div>
          </div>
        </div>

        {monthPlan > 0 && (
          <div>
            <div className="h-2.5 w-full rounded-full bg-[#f0eee9] overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, planPercent)}%` }}
              />
            </div>
            <div className="text-[11px] text-muted-foreground mt-1.5">{planPercent}% плана выполнено</div>
          </div>
        )}

        <div className="pt-1">
          {!hasEnoughData ? (
            <Badge variant="secondary" className="bg-[#f7f6f3] text-[#5c5950] border-[#ebe9e4]/60">
              Мало данных — прогноз с 5-го числа
            </Badge>
          ) : monthPlan > 0 ? (
            <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">
              При таком темпе: {forecastPercent}% плана
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-[#f7f6f3] text-[#5c5950] border-[#ebe9e4]/60">
              Задайте план отдела в разделе «Планы»
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── 3. Воронка-мини ───
function FunnelSection({ funnel }: { funnel: DashboardData['funnel'] }) {
  const steps = [
    { label: 'База клиентов', value: funnel.base },
    { label: 'Обзвонено за месяц', value: funnel.called },
    { label: 'Дозвонились', value: funnel.reached },
    { label: 'Заказы за месяц', value: funnel.orders },
  ]
  const max = Math.max(funnel.base, 1)

  return (
    <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-[#ebe9e4]/60">
        <CardTitle className="text-[16px] font-semibold text-foreground">Воронка за месяц</CardTitle>
        <CardDescription>От базы клиентов до заказов</CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-3">
        {steps.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-[#5c5950]">{s.label}</span>
              <span className="font-semibold text-foreground">{fmtMoney.format(s.value)}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#f0eee9] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#cbb89a]"
                style={{ width: `${Math.min(100, Math.round((s.value / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── 4. Качество звонков ───
function QualitySection({ calls }: { calls: DashboardData['lowScoreCalls'] }) {
  return (
    <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-[#ebe9e4]/60">
        <CardTitle className="text-[16px] font-semibold text-foreground">Качество звонков</CardTitle>
        <CardDescription>Последние звонки с оценкой ниже 6 — стоит послушать</CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Нет звонков с низкой оценкой — хорошо.</p>
        ) : (
          <ul className="divide-y divide-[#ebe9e4]/60">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5">
                <Link
                  href={`/clients/${c.clientId}`}
                  className="text-sm font-medium text-foreground hover:text-emerald-600 hover:underline"
                >
                  {c.clientName}
                </Link>
                <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200">
                  {c.score}/10
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
