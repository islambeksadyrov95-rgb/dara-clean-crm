import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { getWazzupStats, type Period } from '@/lib/integrations/stats'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => n.toLocaleString('ru-RU')
const COMMAND_LABELS: Record<string, string> = { 'message.send': 'Отправка сообщения', 'iframe.open': 'Открытие чата' }

export default async function WazzupIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || getUserRole(user) !== 'admin') redirect('/')

  const sp = await searchParams
  const period: Period = sp.period === 'today' ? 'today' : 'month'
  const { stats, recent } = await getWazzupStats(period)

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-200">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Назад в настройки
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Интеграция Wazzup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Исходящие действия через Wazzup: отправка WhatsApp и открытие чатов. Тарификация Wazzup — подписочная, не за действие.
        </p>
      </div>

      <PeriodTabs base="/settings/integrations/wazzup" period={period} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Действий всего" value={fmt(stats.total)} />
        <StatCard label="Ошибки" value={fmt(stats.errors)} accent="text-rose-600" />
      </div>

      <section className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm">
        <div className="border-b border-[#ebe9e4]/60 px-4 py-3 text-sm font-semibold">По типу действия</div>
        {stats.byCommand.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Действий за период нет</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {stats.byCommand.map((c) => (
                <tr key={c.command} className="border-b border-[#ebe9e4]/40 last:border-0">
                  <td className="px-4 py-2">{COMMAND_LABELS[c.command] ?? c.command}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(c.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm">
        <div className="border-b border-[#ebe9e4]/60 px-4 py-3 text-sm font-semibold">Последние действия</div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Действий пока нет</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#fcfcfb] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Время</th>
                <th className="px-4 py-2 font-medium">Действие</th>
                <th className="px-4 py-2 font-medium">Чат</th>
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
                  <td className="px-4 py-2 text-xs">{COMMAND_LABELS[r.command] ?? r.command}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.chat_id ?? '—'}</td>
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
