import { NextResponse } from 'next/server'
import { Client } from 'pg'

export const dynamic = 'force-dynamic'

const regions = [
  'ap-southeast-2', // Sydney
  'ap-southeast-1', // Singapore
  'eu-central-1',   // Frankfurt
  'eu-west-1',      // Ireland
  'eu-west-2',      // London
  'us-east-1',      // N. Virginia
  'us-east-2',      // Ohio
  'us-west-1',      // N. California
  'us-west-2',      // Oregon
  'ap-east-1',      // Hong Kong
  'ap-south-1',     // Mumbai
  'sa-east-1',      // Sao Paulo
  'ca-central-1'    // Canada
]

const sql = `
-- Таблица шаблонов предложений (пользовательские сценарии)
create table if not exists public.broadcast_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'custom',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Таблица логов рассылок
create table if not exists public.broadcast_logs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  manager_id    uuid not null references auth.users(id),
  scenario      text not null,
  message_text  text not null,
  status        text not null check (status in ('sent', 'failed')),
  error_message text,
  sent_at       timestamptz not null default now()
);

-- Indexing
create index if not exists idx_broadcast_logs_client on public.broadcast_logs(client_id);
create index if not exists idx_broadcast_logs_date on public.broadcast_logs(sent_at);
create index if not exists idx_broadcast_templates_created_by on public.broadcast_templates(created_by);

-- Enable RLS
alter table public.broadcast_templates enable row level security;
alter table public.broadcast_logs enable row level security;

-- Policies for broadcast_templates
drop policy if exists "authenticated can select templates" on public.broadcast_templates;
create policy "authenticated can select templates"
  on public.broadcast_templates for select to authenticated using (true);

drop policy if exists "authenticated can insert templates" on public.broadcast_templates;
create policy "authenticated can insert templates"
  on public.broadcast_templates for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "authenticated can delete templates" on public.broadcast_templates;
create policy "authenticated can delete templates"
  on public.broadcast_templates for delete to authenticated 
  using (auth.uid() = created_by or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Policies for broadcast_logs
drop policy if exists "authenticated can select logs" on public.broadcast_logs;
create policy "authenticated can select logs"
  on public.broadcast_logs for select to authenticated using (true);

drop policy if exists "authenticated can insert logs" on public.broadcast_logs;
create policy "authenticated can insert logs"
  on public.broadcast_logs for insert to authenticated with check (auth.uid() = manager_id);
`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')

  const cleanKey = (k: string | undefined) => (k ?? '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim()
  if (cleanKey(secret) !== cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const logs: string[] = []

  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    for (const port of [6543, 5432]) {
      const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:${port}/postgres`
      
      logs.push(`Probing ${region} on port ${port}...`)
      
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: 2000,
        ssl: { rejectUnauthorized: false }
      })
      
      try {
        await client.connect()
        logs.push(`✅ Connected to ${region} on port ${port}! Applying migration...`)
        
        await client.query(sql)
        logs.push('✅ Migration applied successfully!')
        
        await client.end()
        return NextResponse.json({ success: true, logs })
      } catch (err: any) {
        logs.push(`❌ Failed: ${err.message}`)
      }
    }
  }

  return NextResponse.json({ success: false, error: 'Could not connect to any region/port', logs }, { status: 500 })
}
