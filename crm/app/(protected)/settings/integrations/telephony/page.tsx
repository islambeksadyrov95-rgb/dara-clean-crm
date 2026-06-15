import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { getTelephonyStats, type Period } from '@/lib/integrations/stats'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => n.toLocaleString('ru-RU')
const DIRECTION_LABELS: Record<string, string> = { inbound: 'Входящие', outbound: 'Исходящие', internal: 'Внутренние' }

export default async function TelephonyIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || getUserRole(user) !== 'admin') redirect('/')

  const sp = await searchParams
  const period: Period = sp.period === 'today' ? 'today' : 'month'
  const { stats, recent } = await getTelephonyStats(period)

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-200">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Назад в настройки
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Интеграция Телефония</h1>
          <p className="mt-1 text-sm text-muted-foreground">Звонки и события Beeline VPBX, прошедшие через интеграцию.</p>
        </div>
        <Link
          href="/settings/telephony"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#ebe9e4] bg-white px-3 py-2 text-sm text-[#5c5950] hover:bg-[#f7f6f3]"
        >
          <Settings className="h-4 w-4" /> Настройки телефонии
        </Link>
      </div>

      <PeriodTabs base="/settings/integrations/telephony" period={period} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Звонков всего" value={fmt(stats.total)} />
        <StatCard label="С записью" value={fmt(stats.recorded)} accent="text-blue-600" />
        <StatCard label="События (webhook)" value={fmt(stats.events)} accent="text-violet-600" />
        <StatCard label="Направлений" value={fmt(stats.byDirection.length)} />
      </div>

      <section className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm">
        <div className="border-b border-[#ebe9e4]/60 px-4 py-3 text-sm font-semibold">По направлению</div>
        {stats.byDirection.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Звонков за период нет</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {stats.byDirection.map((d) => (
                <tr key={d.direction} className="border-b border-[#ebe9e4]/40 last:border-0">
                  <td className="px-4 py-2">{DIRECTION_LABELS[d.direction] ?? d.direction}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(d.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm">
        <div className="border-b border-[#ebe9e4]/60 px-4 py-3 text-sm font-semibold">Последние звонки</div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Звонков пока нет</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#fcfcfb] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Время</th>
                <th className="px-4 py-2 font-medium">Направление</th>
                <th className="px-4 py-2 font-medium">Номера</th>
                <th className="px-4 py-2 font-medium">Запись</th>
                <th className="px-4 py-2 text-right font-medium">сек</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b border-[#ebe9e4]/40 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-4 py-2 text-xs">{DIRECTION_LABELS[r.direction] ?? r.direction}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.number_a ?? '—'} → {r.number_b ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{r.is_recorded ? 'да' : '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground">{fmt(r.duration)}</td>
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
