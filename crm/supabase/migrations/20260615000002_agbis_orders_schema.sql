-- Agbis integration — Migration: order line items + sync mirror columns + atomic order RPC (Phase 1)
-- Additive only. Does NOT change the live order-creation flow (queue/order/actions.ts stays as-is;
-- it is rewired onto create_order_with_items in Phase 4 with the form rebuild).
-- Money: all amounts integer (WHOLE TENGE) per database.md (money = integer).
-- Wrapped in begin/commit for all-or-nothing apply (matches 20260612000001_money_to_integer.sql).
-- See: docs/integrations/agbis-api/PLAN.md (v2 — B2, B5), DECISIONS.md
-- Created: 2026-06-15
--
-- DOWN migration (manual rollback):
--   begin;
--   drop function if exists public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb);
--   drop index if exists public.idx_orders_sync_status;
--   drop index if exists public.uq_orders_agbis_order_id;
--   alter table public.orders
--     drop column if exists agbis_order_id, drop column if exists agbis_doc_num,
--     drop column if exists agbis_sclad_id, drop column if exists agbis_sclad_out_id,
--     drop column if exists agbis_price_id, drop column if exists agbis_status_id,
--     drop column if exists agbis_status_name, drop column if exists agbis_synced_at,
--     drop column if exists sync_status, drop column if exists sync_error;
--   drop index if exists public.idx_clients_sync_status;
--   drop index if exists public.uq_clients_agbis_client_id;
--   alter table public.clients
--     drop column if exists agbis_client_id, drop column if exists agbis_synced_at,
--     drop column if exists sync_status, drop column if exists sync_error;
--   drop policy if exists order_items_select on public.order_items;
--   drop table if exists public.order_items;
--   commit;

begin;

-- ============================================================
-- 1. order_items — structured line items for CRM-created orders.
--    Source of order positions; orders.services[] kept for back-compat (names).
--    Written ONLY via create_order_with_items (SECURITY DEFINER) + service role (sync).
-- ============================================================
create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  agbis_tovar_id   text,                                                  -- price-catalog item id (agbis_price_items.agbis_tovar_id)
  name             text not null,
  qty              integer not null default 1 check (qty > 0),
  kfx              numeric,                                               -- Agbis coefficient (area/factor); null if n/a
  unit_price       integer not null default 0 check (unit_price >= 0),   -- WHOLE TENGE
  line_amount      integer not null default 0 check (line_amount >= 0),  -- WHOLE TENGE (Agbis-authoritative, D1)
  discount_percent numeric(5,2) not null default 0,
  addons           jsonb,
  created_at       timestamptz not null default now()
);

create index idx_order_items_order on public.order_items (order_id);

alter table public.order_items enable row level security;

-- SELECT: manager sees items of own orders, admin sees all — via parent join (B5).
-- Admin check via app_metadata (matches orders / order_history). Mirrors the orders posture.
create policy order_items_select on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or o.manager_id = auth.uid()
        )
    )
  );
-- No INSERT/UPDATE/DELETE policies for authenticated: deny-by-default. The only write
-- path is create_order_with_items (atomic, recomputes aggregates) + service role (sync).

-- ============================================================
-- 2. clients — Agbis sync mirror columns (nullable, no backfill needed).
-- ============================================================
alter table public.clients
  add column if not exists agbis_client_id text,
  add column if not exists agbis_synced_at timestamptz,
  add column if not exists sync_status text not null default 'local'
    check (sync_status in ('local','synced','pending','error')),
  add column if not exists sync_error text;

-- Partial unique: many local clients have NULL agbis_client_id; only linked ones must be unique.
create unique index uq_clients_agbis_client_id
  on public.clients (agbis_client_id) where agbis_client_id is not null;
create index idx_clients_sync_status
  on public.clients (sync_status) where sync_status in ('pending','error');

-- ============================================================
-- 3. orders — Agbis sync mirror columns (nullable). agbis_status_* is a READ-ONLY
--    mirror of the Agbis status (we take statuses from Agbis, we do not invent them).
--    Written only by sync (service role) — orders has no UPDATE policy for authenticated.
-- ============================================================
alter table public.orders
  add column if not exists agbis_order_id text,
  add column if not exists agbis_doc_num text,
  add column if not exists agbis_sclad_id text,
  add column if not exists agbis_sclad_out_id text,
  add column if not exists agbis_price_id text,
  add column if not exists agbis_status_id smallint,
  add column if not exists agbis_status_name text,
  add column if not exists agbis_synced_at timestamptz,
  add column if not exists sync_status text not null default 'local'
    check (sync_status in ('local','synced','pending','error')),
  add column if not exists sync_error text;

create unique index uq_orders_agbis_order_id
  on public.orders (agbis_order_id) where agbis_order_id is not null;
create index idx_orders_sync_status
  on public.orders (sync_status) where sync_status in ('pending','error');

-- ============================================================
-- 4. create_order_with_items — ONE atomic transaction: orders + order_items +
--    idempotent aggregate recompute (B2). Replaces the non-atomic JS flow that did
--    "+= amount" (drifts from order_history-aware recalc).
--    - SECURITY DEFINER: needs to call recalc_client_aggregates (revoked from authenticated)
--      and to write order_items (deny-by-default).
--    - manager_id is pinned to auth.uid() (anti-IDOR; replaces the orders INSERT RLS check).
--    - Does NOT compute discounts: caller passes discount_percent/amount (engine stays in app/form, D1).
--    - Aggregates via the single source of truth recalc_client_aggregates (recompute, NOT +=).
-- ============================================================
create or replace function public.create_order_with_items(
  p_client_id        uuid,
  p_services         text[],
  p_amount           integer,
  p_discount_percent numeric default 0,
  p_discount_amount  integer default 0,
  p_comment          text default null,
  p_items            jsonb default '[]'::jsonb
)
returns table (order_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_order_id   uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_services is null or array_length(p_services, 1) is null then
    raise exception 'no_services' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  insert into public.orders (
    client_id, manager_id, services, amount, discount_percent, discount_amount, comment
  )
  values (
    p_client_id, v_uid, p_services, p_amount,
    coalesce(p_discount_percent, 0), coalesce(p_discount_amount, 0), p_comment
  )
  returning orders.id, orders.created_at into v_order_id, v_created_at;

  -- Structured line items (optional; empty for legacy CRM orders without the new form).
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.order_items (
      order_id, agbis_tovar_id, name, qty, kfx, unit_price, line_amount, discount_percent, addons
    )
    select
      v_order_id,
      nullif(it ->> 'agbis_tovar_id', ''),
      it ->> 'name',
      coalesce((it ->> 'qty')::int, 1),
      nullif(it ->> 'kfx', '')::numeric,
      coalesce((it ->> 'unit_price')::int, 0),
      coalesce((it ->> 'line_amount')::int, 0),
      coalesce((it ->> 'discount_percent')::numeric, 0),
      it -> 'addons'  -- jsonb value, or SQL NULL when the key is absent
    from jsonb_array_elements(p_items) as it;
  end if;

  -- Preserve current behavior: auto-assign an unassigned client to the creating manager.
  update public.clients
    set assigned_manager_id = v_uid
    where id = p_client_id and assigned_manager_id is null;

  -- Aggregates: single source of truth, idempotent recompute (NOT +=).
  perform public.recalc_client_aggregates(array[p_client_id]);

  return query select v_order_id, v_created_at;
end;
$$;

-- Callable by authenticated managers (runs the order-creation flow); never anon/public.
revoke execute on function public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb)
  from public, anon;
grant execute on function public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb)
  to authenticated;

commit;
