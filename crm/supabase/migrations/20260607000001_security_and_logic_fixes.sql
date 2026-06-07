-- Migration: Security and Logic Fixes
-- 1. Create public.profiles table synced with auth.users
-- 2. Update RLS update policy for clients (allowing managers to assign NULL clients)
-- 3. Recreate client_segments view with call status filtering
-- Created: 2026-06-07

-- ============================================================
-- 1. PROFILES TABLE & TRIGGER
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_profiles_email on public.profiles (email);

-- Enable RLS
alter table public.profiles enable row level security;

-- RLS Policies
drop policy if exists "authenticated can select profiles" on public.profiles;
create policy "authenticated can select profiles"
  on public.profiles for select to authenticated
  using (true);

-- Trigger function to sync profiles
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'manager')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

-- Trigger
drop trigger if exists on_auth_user_created_or_updated on auth.users;
create trigger on_auth_user_created_or_updated
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();

-- One-time backfill for existing users
insert into public.profiles (id, email, name, role)
select 
  id, 
  email, 
  coalesce(raw_user_meta_data ->> 'name', split_part(email, '@', 1)), 
  coalesce(raw_user_meta_data ->> 'role', 'manager')
from auth.users
on conflict (id) do nothing;

-- ============================================================
-- 2. CLIENTS RLS UPDATE POLICY
-- ============================================================

drop policy if exists "authenticated can update clients" on public.clients;

create policy "authenticated can update clients"
  on public.clients for update to authenticated
  using (
    assigned_manager_id = auth.uid() 
    or assigned_manager_id is null 
    or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  )
  with check (
    assigned_manager_id = auth.uid() 
    or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ============================================================
-- 3. RECREATE client_segments VIEW
-- ============================================================

drop view if exists public.client_segments;

create view public.client_segments as
with last_calls as (
  select distinct on (client_id) client_id, status
  from public.call_logs
  order by client_id, created_at desc
)
select
  c.id,
  c.name,
  c.phone,
  c.address,
  c.total_orders,
  c.total_spent,
  c.last_order_date,
  c.last_called_at,
  c.locked_by,
  c.locked_until,
  c.assigned_manager_id,
  case
    when c.last_order_date is not null
      and (current_date - c.last_order_date) > 180
      then 'Потерянный'
    when c.last_order_date is not null
      and (current_date - c.last_order_date) > 90
      then 'В риске'
    when c.total_orders >= 4
      then 'Постоянный'
    when c.total_orders between 2 and 3
      then 'Повторный'
    else 'Новый'
  end as rfm_segment,
  case
    when c.last_order_date is not null
      then (current_date - c.last_order_date)
    else null
  end as days_since_last_order
from public.clients c
left join last_calls lc on lc.client_id = c.id
where lc.status is null or (lc.status != 'declined' and lc.status != 'not_relevant');
