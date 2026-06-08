-- Migration: Broadcasts and Templates
-- Created: 2026-06-08

-- Таблица шаблонов предложений (пользовательские сценарии)
create table if not exists public.broadcast_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'custom', -- 'custom', 'season', etc.
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
