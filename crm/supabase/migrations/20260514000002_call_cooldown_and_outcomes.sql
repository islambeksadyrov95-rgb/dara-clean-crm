-- Migration 002: Call cooldown + expanded outcomes
-- 1. Add last_called_at to clients (cooldown filter)
-- 2. Expand call_logs status options
-- 3. Add notes and next_call_date to call_logs
-- 4. Update client_segments view to include last_called_at
-- Created: 2026-05-14

-- ============================================================
-- 1. CLIENTS: add last_called_at
-- ============================================================

alter table public.clients
  add column if not exists last_called_at timestamptz;

create index if not exists idx_clients_last_called on public.clients (last_called_at);

-- ============================================================
-- 2. CALL_LOGS: expand status + add fields
-- ============================================================

-- Расширяем допустимые статусы
alter table public.call_logs
  drop constraint if exists call_logs_status_check;

alter table public.call_logs
  add constraint call_logs_status_check
  check (status in ('reached', 'not_reached', 'callback', 'declined', 'not_relevant'));

-- Заметки менеджера по звонку
alter table public.call_logs
  add column if not exists notes text;

-- Дата перезвона (для статуса 'callback')
alter table public.call_logs
  add column if not exists next_call_date date;

-- ============================================================
-- 3. UPDATE client_segments VIEW (drop + recreate: column order changed)
-- ============================================================

drop view if exists public.client_segments;
create view public.client_segments as
select
  id,
  name,
  phone,
  total_orders,
  total_spent,
  last_order_date,
  last_called_at,
  locked_by,
  locked_until,
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
