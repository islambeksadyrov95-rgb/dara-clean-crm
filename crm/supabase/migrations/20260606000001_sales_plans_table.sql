-- Migration: Create sales_plans table for dynamic sales targets
-- Created: 2026-06-06

create table public.sales_plans (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references auth.users(id) on delete cascade,
  month integer not null check (month >= 1 and month <= 12),
  year integer not null,
  carpets_target numeric(12,2) not null default 0,
  furniture_target numeric(12,2) not null default 0,
  curtains_target numeric(12,2) not null default 0,
  repeat_target numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(manager_id, month, year)
);

-- Индексы для быстрого поиска
create index idx_sales_plans_manager_date on public.sales_plans (manager_id, year, month);

-- Включаем RLS
alter table public.sales_plans enable row level security;

-- Политики безопасности (RLS)
create policy "authenticated can select sales_plans"
  on public.sales_plans for select to authenticated using (true);

create policy "admin can manage sales_plans"
  on public.sales_plans for all to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
