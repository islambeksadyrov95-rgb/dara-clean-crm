-- Migration: Add assigned_manager_id to clients and update RLS policies
-- Created: 2026-06-06

-- 1. Добавление колонки в clients
alter table public.clients
  add column if not exists assigned_manager_id uuid references auth.users(id) on delete set null;

create index if not exists idx_clients_assigned_manager on public.clients (assigned_manager_id);

-- 2. Обновление вью client_segments (drop и воссоздание)
drop view if exists public.client_segments;
create view public.client_segments as
select
  id,
  name,
  phone,
  address,
  total_orders,
  total_spent,
  last_order_date,
  last_called_at,
  locked_by,
  locked_until,
  assigned_manager_id,
  case
    when last_order_date is not null
      and (current_date - last_order_date) > 180
      then 'Потерянный'
    when last_order_date is not null
      and (current_date - last_order_date) > 90
      then 'В риске'
    when total_orders >= 4
      then 'Постоянный'
    when total_orders between 2 and 3
      then 'Повторный'
    else 'Новый'
  end as rfm_segment,
  case
    when last_order_date is not null
      then (current_date - last_order_date)
    else null
  end as days_since_last_order
from public.clients;

-- 3. Обновление политик RLS на clients
drop policy if exists "authenticated can select clients" on public.clients;
drop policy if exists "admin can insert clients" on public.clients;
drop policy if exists "admin can update clients" on public.clients;
drop policy if exists "manager can lock clients" on public.clients;

-- Менеджер видит только своих клиентов, админ видит всех
create policy "authenticated can select clients"
  on public.clients for select to authenticated
  using (assigned_manager_id = auth.uid() or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Менеджеры могут создавать клиентов (закрепляя за собой), админы могут создавать любых
create policy "authenticated can insert clients"
  on public.clients for insert to authenticated
  with check (assigned_manager_id = auth.uid() or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Менеджер может обновлять только своего клиента, админ любого
create policy "authenticated can update clients"
  on public.clients for update to authenticated
  using (assigned_manager_id = auth.uid() or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  with check (assigned_manager_id = auth.uid() or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
