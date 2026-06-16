-- Agbis order-parity — Wave 1: two independent trip arms (Забор/Выдача) via a child table.
-- An order has TWO independent fulfillment legs, not one mutually-exclusive choice:
--   pickup  (Забор,  Agbis tp=1) — self|trip
--   delivery(Выдача, Agbis tp=2) — self|trip
-- order_trips is the source of truth for выезды; only "trip" legs get a row (self = no row).
-- Writes are service-role only (orders/order_trips have no authenticated UPDATE). SELECT mirrors
-- orders via the parent (admin: all; manager: own). Each row carries its own sync_status so a
-- partial failure (pickup synced, delivery failed) is retried independently by the outbox/cron.
-- This REPLACES the single-leg denormalized columns on orders (Wave 3, now dropped after backfill).
-- Created: 2026-06-16
--
-- DOWN migration (manual rollback):
--   begin;
--   alter table public.orders
--     add column if not exists delivery_type text not null default 'self'
--       check (delivery_type in ('self','pickup','dropoff')),
--     add column if not exists delivery_address text,
--     add column if not exists region_id text,
--     add column if not exists agbis_car_id text,
--     add column if not exists agbis_trip_id text,
--     add column if not exists trip_window_from text,
--     add column if not exists trip_window_to text;
--   -- (data not restored)
--   alter table public.agbis_outbox drop constraint agbis_outbox_entity_check;
--   alter table public.agbis_outbox add constraint agbis_outbox_entity_check
--     check (entity in ('client','order','status','pay'));
--   drop table if exists public.order_trips;
--   commit;

begin;

-- 1. order_trips — one row per "trip" leg of an order.
create table public.order_trips (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  kind          text not null check (kind in ('pickup','delivery')),  -- Забор / Выдача
  address       text not null,
  agbis_car_id  text,                                                 -- Agbis Cars.id
  agbis_trip_id text,                                                 -- Agbis TripOrder.TripID (set on sync)
  window_from   text,                                                 -- hr    "11:00"
  window_to     text,                                                 -- hr_to "12:00"
  trip_date     date,                                                 -- Almaty calendar date of the trip
  sync_status   text not null default 'pending'
                  check (sync_status in ('pending','synced','failed')),
  sync_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, kind)                                             -- at most one pickup + one delivery
);

create index idx_order_trips_order_id on public.order_trips (order_id);

alter table public.order_trips enable row level security;

create policy "admin can select all order_trips"
  on public.order_trips for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "manager can select own order_trips"
  on public.order_trips for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'manager'
    and exists (
      select 1 from public.orders o
      where o.id = order_trips.order_id and o.manager_id = auth.uid()
    )
  );

-- 2. agbis_outbox — allow trip retries (entity='trip').
alter table public.agbis_outbox drop constraint agbis_outbox_entity_check;
alter table public.agbis_outbox add constraint agbis_outbox_entity_check
  check (entity in ('client','order','trip','status','pay'));

-- 3. Backfill existing single-leg orders into order_trips, then drop the legacy columns.
insert into public.order_trips (order_id, kind, address, agbis_car_id, agbis_trip_id, window_from, window_to, sync_status)
select
  id,
  case when delivery_type = 'pickup' then 'pickup' else 'delivery' end,
  delivery_address,
  agbis_car_id,
  agbis_trip_id,
  trip_window_from,
  trip_window_to,
  case when agbis_trip_id is not null then 'synced' else 'pending' end
from public.orders
where delivery_type is not null
  and delivery_type <> 'self'
  and delivery_address is not null;

alter table public.orders
  drop column if exists delivery_type,
  drop column if exists delivery_address,
  drop column if exists region_id,
  drop column if exists agbis_car_id,
  drop column if exists agbis_trip_id,
  drop column if exists trip_window_from,
  drop column if exists trip_window_to;

commit;
