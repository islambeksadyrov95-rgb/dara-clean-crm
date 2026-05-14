-- Dara Clean CRM — Migration 001: Schema
-- Tables: clients, orders, call_logs
-- RLS policies for manager/admin roles
-- client_segments view with RFM labels
-- Created: 2026-05-14

-- ============================================================
-- 1. TABLES
-- ============================================================

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text not null unique,
  address         text,
  total_orders    integer not null default 0,
  total_spent     numeric(12,2) not null default 0,
  avg_order_value numeric(12,2) not null default 0,
  last_order_date date,
  locked_by       uuid references auth.users(id) on delete set null,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  manager_id       uuid not null references auth.users(id),
  services         text[] not null,
  amount           numeric(12,2) not null,
  discount_percent numeric(5,2) not null default 0,
  discount_amount  numeric(12,2) not null default 0,
  comment          text,
  created_at       timestamptz not null default now()
);

create table public.call_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  manager_id  uuid not null references auth.users(id),
  status      text not null check (status in ('reached', 'not_reached')),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

create index idx_clients_phone on public.clients (phone);
create index idx_clients_last_order on public.clients (last_order_date);
create index idx_clients_locked on public.clients (locked_by);
create index idx_orders_client on public.orders (client_id);
create index idx_orders_manager on public.orders (manager_id);
create index idx_call_logs_client on public.call_logs (client_id);
create index idx_call_logs_manager on public.call_logs (manager_id);
create index idx_call_logs_date on public.call_logs (created_at);

-- ============================================================
-- 3. ENABLE RLS
-- ============================================================

alter table public.clients   enable row level security;
alter table public.orders    enable row level security;
alter table public.call_logs enable row level security;

-- ============================================================
-- 4. RLS POLICIES — clients
-- ============================================================

create policy "authenticated can select clients"
  on public.clients for select
  to authenticated
  using (true);

create policy "admin can insert clients"
  on public.clients for insert
  to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "admin can update clients"
  on public.clients for update
  to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Менеджер может обновлять locked_by/locked_until (атомарная блокировка Phase 5)
create policy "manager can lock clients"
  on public.clients for update
  to authenticated
  using (true)
  with check (true);

create policy "admin can delete clients"
  on public.clients for delete
  to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- ============================================================
-- 5. RLS POLICIES — orders
-- ============================================================

create policy "admin can select all orders"
  on public.orders for select
  to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "manager can select own orders"
  on public.orders for select
  to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    and manager_id = auth.uid()
  );

create policy "authenticated can insert orders"
  on public.orders for insert
  to authenticated
  with check (manager_id = auth.uid());

-- ============================================================
-- 6. RLS POLICIES — call_logs
-- ============================================================

create policy "admin can select all call_logs"
  on public.call_logs for select
  to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "manager can select own call_logs"
  on public.call_logs for select
  to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    and manager_id = auth.uid()
  );

create policy "authenticated can insert call_logs"
  on public.call_logs for insert
  to authenticated
  with check (manager_id = auth.uid());

-- ============================================================
-- 7. CLIENT SEGMENTS VIEW (RFM)
-- ============================================================

create or replace view public.client_segments as
select
  id,
  name,
  phone,
  total_orders,
  total_spent,
  last_order_date,
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

-- ============================================================
-- 8. UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_updated_at
  before update on public.clients
  for each row execute procedure public.set_updated_at();
