import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Database, Phone, MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'

export const dynamic = 'force-dynamic'

const INTEGRATIONS = [
  { href: '/settings/integrations/agbis', label: 'Агбис', icon: Database, desc: 'Записывающие команды и платные транзакции' },
  { href: '/settings/integrations/telephony', label: 'Телефония', icon: Phone, desc: 'Звонки и события Beeline VPBX' },
  { href: '/settings/integrations/wazzup', label: 'Wazzup', icon: MessageCircle, desc: 'Отправка WhatsApp и открытие чатов' },
]

export default async function IntegrationsIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || getUserRole(user) !== 'admin') redirect('/')

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-200">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Назад в настройки
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Интеграции</h1>
        <p className="mt-1 text-sm text-muted-foreground">Мониторинг действий по каждой интеграции.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map(({ href, label, icon: Icon, desc }) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border border-[#ebe9e4] bg-white p-5 shadow-sm transition-colors hover:bg-[#f7f6f3]"
          >
            <Icon className="h-5 w-5 text-[#5c5950]" />
            <div className="mt-3 text-base font-semibold">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
