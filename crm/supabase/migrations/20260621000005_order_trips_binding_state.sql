-- Trip binding state — make «привязан к заказу» an explicit, true fact in CRM.
--
-- Problem: order_trips.sync_status='synced' means only that TripOrder (REST) created the Agbis
-- MOBILE_PLAN — NOT that the trip is BOUND to its order. Agbis public API cannot bind a trip to an
-- order (proven — project_agbis_trip_binding): binding lives in the local Firebird junction table
-- MOBILE_PLAN_ORDERS, written by a local agent on the admin machine. So 'synced' over-promises.
--
-- This migration adds the true binding state, written back by that agent (service role):
--   * bound_at    — when the junction was confirmed in Firebird (null = not bound yet)
--   * junction_id — the MOBILE_PLAN_ORDERS.ID the agent wrote (traceability + idempotency)
--
-- The agent polls «synced but unbound»: agbis_trip_id is not null AND bound_at is null. Partial index
-- below serves exactly that poll. No RLS change: existing SELECT policies (admin all / manager own)
-- cover the new columns; order_trips has no authenticated write path — the agent uses service role.
--
-- DOWN migration (manual rollback):
--   drop index if exists public.idx_order_trips_unbound;
--   alter table public.order_trips drop column if exists bound_at, drop column if exists junction_id;
-- Created: 2026-06-21

begin;

alter table public.order_trips
  add column if not exists bound_at    timestamptz,
  add column if not exists junction_id text;

-- Agent poll: synced trips not yet bound. Tiny set (only CRM trips), partial keeps it cheap.
create index if not exists idx_order_trips_unbound
  on public.order_trips (agbis_trip_id)
  where bound_at is null and agbis_trip_id is not null;

commit;
