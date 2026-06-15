import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { getAgbisStats, type Period } from '@/lib/integrations/stats'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => n.toLocaleString('ru-RU')
// Грубая оценка стоимости. Точный тариф Агбиса уточняется (см. 06-tariffs.md).
const EST_RATE_PER_COMMAND = 3

export default async function AgbisIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || getUserRole(user) !== 'admin') redirect('/')

  const sp = await searchParams
  const period: Period = sp.period === 'today' ? 'today' : 'month'
  let data: Awaited<ReturnType<typeof getAgbisStats>>
  try {
    data = await getAgbisStats(period)
  } catch (err) {
    console.error('[integration-agbis]', err)
    return <IntegrationError title="Интеграция Агбис" />
  }
  const { stats, recent } = data

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-200">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Назад в настройки
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Интеграция Агбис</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Тарифицируются только записывающие команды. Платные = успешная запись (billed). Чтение и сбои — бесплатны.
        </p>
      </div>

      <PeriodTabs base="/settings/integrations/agbis" period={period} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Платные транзакции" value={fmt(stats.paid)} accent="text-amber-600" />
        <StatCard label="Бесплатные" value={fmt(stats.free)} accent="text-emerald-600" />
        <StatCard label="Всего запросов" value={fmt(stats.total)} />
        <StatCard label="Ошибки (бесплатно)" value={fmt(stats.errors)} accent="text-rose-600" />
      </div>

      <div className="rounded-xl border border-[#ebe9e4] bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted-foreground">
            Оценка стоимости (≈ 3 ₽ за команду, см. <code className="text-xs">docs/integrations/agbis-api/06-tariffs.md</code>)
          </span>
          <span className="text-lg font-semibold">{fmt(stats.paid * EST_RATE_PER_COMMAND)} ₽</span>
        </div>
        {stats.executedApiCount !== null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Агбис насчитал коммерческих команд (ExecutedApiCount): <b>{fmt(stats.executedApiCount)}</b>. Сверьте с «Платные» выше.
          </p>
        )}
      </div>

      <section className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm">
        <div className="border-b border-[#ebe9e4]/60 px-4 py-3 text-sm font-semibold">Платные команды за период</div>
        {stats.byCommand.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Платных команд за период нет</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {stats.byCommand.map((c) => (
                <tr key={c.command} className="border-b border-[#ebe9e4]/40 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{c.command}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(c.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm">
        <div className="border-b border-[#ebe9e4]/60 px-4 py-3 text-sm font-semibold">Последние запросы</div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Записей пока нет</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#fcfcfb] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Время</th>
                <th className="px-4 py-2 font-medium">Команда</th>
                <th className="px-4 py-2 font-medium">Тариф</th>
                <th className="px-4 py-2 font-medium">Ошибка</th>
                <th className="px-4 py-2 text-right font-medium">мс</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b border-[#ebe9e4]/40 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.command}</td>
                  <td className="px-4 py-2">
                    {r.billed ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">платно</span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">бесплатно</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.error_code ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground">{r.latency_ms ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#ebe9e4] bg-white p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

function IntegrationError({ title }: { title: string }) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Не удалось загрузить статистику. Обновите страницу или проверьте логи сервера.
      </p>
    </div>
  )
}

function PeriodTabs({ base, period }: { base: string; period: Period }) {
  const tab = (key: Period, label: string) => (
    <Link
      href={`${base}?period=${key}`}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
        period === key ? 'bg-foreground text-background' : 'bg-white text-[#5c5950] hover:bg-[#f0eee9]'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex gap-2">
      {tab('today', 'Сегодня')}
      {tab('month', 'Месяц')}
    </div>
  )
}
