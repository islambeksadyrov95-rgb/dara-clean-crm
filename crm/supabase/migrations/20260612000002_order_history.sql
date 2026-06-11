-- Migration: order_history — imported historical orders (Agbis import)
-- Separate from public.orders: historical orders have no manager, need the ACTUAL
-- order date (not row created_at), and must not pollute the live order KPI/state-machine.
-- Money: amount is integer (WHOLE TENGE, no tiyn) per database.md (money = integer).
-- Source of truth for client order history = order_history (filled by import action under service role).
-- Created: 2026-06-12
--
-- DOWN migration (manual rollback):
--   DROP POLICY IF EXISTS oh_write ON public.order_history;
--   DROP POLICY IF EXISTS oh_select ON public.order_history;
--   DROP INDEX IF EXISTS public.idx_order_history_batch;
--   DROP INDEX IF EXISTS public.idx_order_history_client_date;
--   DROP INDEX IF EXISTS public.idx_order_history_client_id;
--   DROP TABLE IF EXISTS public.order_history;

-- ============================================================
-- 1. order_history — imported historical orders
-- ============================================================
create table if not exists public.order_history (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  order_date      date not null,                            -- historical date (from Agbis group)
  amount          integer not null default 0 check (amount >= 0),  -- WHOLE TENGE, 0 if absent in source
  service         text,                                     -- «Ковёр»/«Мебель»/… from Услуга column
  address         text,                                     -- address at the time of the order
  source          text not null default 'agbis_import'
                    check (source in ('agbis_import', 'manual')),
  import_batch_id uuid,                                     -- to roll back a specific import
  created_at      timestamptz not null default now()
);

create index if not exists idx_order_history_client_id   on public.order_history (client_id);
create index if not exists idx_order_history_client_date on public.order_history (client_id, order_date desc);
create index if not exists idx_order_history_batch       on public.order_history (import_batch_id);

-- ============================================================
-- 2. RLS — manager sees history of own clients, admin sees all.
--    Imports run under admin via service role (bypasses RLS);
--    the write policy guards direct authenticated calls.
-- ============================================================
alter table public.order_history enable row level security;

-- SELECT: manager sees history of own clients, admin sees all
create policy oh_select on public.order_history for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1 from public.clients c
      where c.id = order_history.client_id
        and c.assigned_manager_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: admin only (FOR ALL is additive with oh_select; admin reads via either path)
create policy oh_write on public.order_history for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
