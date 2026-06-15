-- Agbis Phase 2: full order detail for the complete CRM mirror.
-- Adds order header detail (Agbis dor_id/doc_num, WHO created it, status) to order_history,
-- and a per-line table (WHAT was sold by service) — so imported Agbis orders carry the same
-- detail as CRM-created orders. Additive only (no data wiped here). Money = integer tenge.
-- Created: 2026-06-15
--
-- DOWN migration (manual rollback):
--   begin;
--   drop policy if exists ohi_select on public.order_history_items;
--   drop table if exists public.order_history_items;
--   drop index if exists public.uq_order_history_agbis_dor;
--   alter table public.order_history
--     drop column if exists agbis_dor_id, drop column if exists agbis_doc_num,
--     drop column if exists agbis_user_name, drop column if exists agbis_status_id,
--     drop column if exists agbis_status_name;
--   commit;

begin;

-- ============================================================
-- 1. order_history — Agbis header detail (idempotent reimport key + who created + status)
-- ============================================================
alter table public.order_history
  add column if not exists agbis_dor_id      text,  -- Agbis order id (dor_id) — idempotency key
  add column if not exists agbis_doc_num     text,  -- Agbis document number
  add column if not exists agbis_user_name   text,  -- Agbis employee who created the order (not a CRM user)
  add column if not exists agbis_status_id   smallint,
  add column if not exists agbis_status_name text;

-- One order_history row per Agbis order → re-import upserts by dor_id (no duplicates / double-count).
create unique index if not exists uq_order_history_agbis_dor
  on public.order_history (agbis_dor_id) where agbis_dor_id is not null;

-- ============================================================
-- 2. order_history_items — per-service line breakdown of imported orders ("что продали")
--    Mirrors order_items, but parents to order_history. Written only by import (service role).
-- ============================================================
create table if not exists public.order_history_items (
  id               uuid primary key default gen_random_uuid(),
  order_history_id uuid not null references public.order_history(id) on delete cascade,
  agbis_tovar_id   text,
  name             text not null,
  qty              numeric,                                                -- Agbis qty (can be fractional)
  kfx              numeric,                                                -- coefficient (area/factor)
  unit_price       integer not null default 0 check (unit_price >= 0),    -- WHOLE TENGE
  line_amount      integer not null default 0 check (line_amount >= 0),   -- WHOLE TENGE (Agbis kredit)
  discount_percent numeric(5,2) not null default 0,
  addons           jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_order_history_items_oh on public.order_history_items (order_history_id);

alter table public.order_history_items enable row level security;

-- SELECT: manager sees lines of own clients' history, admin sees all (mirror order_history RLS via parent join).
create policy ohi_select on public.order_history_items for select to authenticated
  using (
    exists (
      select 1
      from public.order_history oh
      join public.clients c on c.id = oh.client_id
      where oh.id = order_history_items.order_history_id
        and (
          (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or c.assigned_manager_id = auth.uid()
        )
    )
  );
-- No authenticated INSERT/UPDATE/DELETE: deny-by-default; import writes via service role only.

commit;
