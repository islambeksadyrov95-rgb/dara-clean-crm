-- Agbis order-parity — local order fulfillment fields (Waves 2 & 3).
-- Additive, nullable, no backfill. These mirror the "standard Agbis order" fields the CRM order
-- form now captures: intake/delivery dates, urgency, and pickup-vs-delivery (выезд/самовывоз).
-- They are written by the service role right after create_order_with_items (orders has no
-- authenticated UPDATE policy), keeping the atomic RPC signature unchanged across waves.
-- Money/time: dates are timestamptz (UTC); Almaty (UTC+5) wall-clock is reconstructed on push.
-- Created: 2026-06-16
--
-- DOWN migration (manual rollback):
--   begin;
--   alter table public.orders
--     drop column if exists intake_date,
--     drop column if exists delivery_date,
--     drop column if exists fast_exec_id,
--     drop column if exists delivery_type,
--     drop column if exists delivery_address,
--     drop column if exists region_id,
--     drop column if exists agbis_car_id,
--     drop column if exists agbis_trip_id,
--     drop column if exists trip_window_from,
--     drop column if exists trip_window_to;
--   commit;

begin;

alter table public.orders
  -- Wave 2 — dates + urgency
  add column if not exists intake_date    date,                         -- дата приёма (Almaty calendar)
  add column if not exists delivery_date  timestamptz,                  -- дата+время выдачи (date_out)
  add column if not exists fast_exec_id   smallint,                     -- Agbis order_times id; null/0 = «Не срочный»
  -- Wave 3 — pickup vs delivery (выезд/самовывоз)
  add column if not exists delivery_type    text not null default 'self'
    check (delivery_type in ('self','pickup','dropoff')),               -- self=самовывоз, pickup=выезд забрать, dropoff=выезд доставить
  add column if not exists delivery_address text,
  add column if not exists region_id        text,                       -- Agbis Regions.id (район Алматы)
  add column if not exists agbis_car_id     text,                       -- Agbis Cars.id (машина выезда)
  add column if not exists agbis_trip_id    text,                       -- Agbis TripOrder.TripID (returned on trip create)
  add column if not exists trip_window_from text,                       -- hr  "11:00"
  add column if not exists trip_window_to   text;                       -- hr_to "12:00"

commit;
