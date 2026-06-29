-- order_date / agbis_date_out in orders_unified were truncated to a calendar date in UTC, not Almaty.
-- intake_date/created_at/delivery_date are timestamptz; `::date` cuts at UTC midnight, so an order
-- taken at 03:50 Almaty (22:50 UTC the day before) landed on the PREVIOUS day. The orders list filters
-- by order_date, so CRM showed a different set than Agbis (Дата приёма) for the same calendar day.
--
-- Fix: truncate to a date in Asia/Almaty (UTC+5, no DST) per database.md §Timezone. CRM branch only —
-- order_history.order_date is already a plain `date` (Agbis-sourced) and needs no conversion.
-- Rebuilds on 20260629000002 (cancelled orders stay visible with their real status; history mirror
-- always suppressed when a CRM order exists). create-or-replace, same columns/types → grants preserved.
-- DOWN: re-apply 20260629000002.
-- Created: 2026-06-29

begin;

create or replace view public.orders_unified
with (security_invoker = on) as
select
  o.id,
  o.client_id,
  b.client_name                                     as client_name,
  b.client_phone                                    as client_phone,
  'crm'::text                                       as source,
  coalesce(
    (o.intake_date at time zone 'Asia/Almaty')::date,
    (o.created_at  at time zone 'Asia/Almaty')::date
  )                                                 as order_date,
  o.amount,
  o.agbis_status_name,
  o.agbis_doc_num,
  o.agbis_order_id                                  as agbis_dor_id,
  nullif(array_to_string(o.services, ', '), '')     as service,
  to_char(o.delivery_date at time zone 'Asia/Almaty', 'YYYY-MM-DD') as agbis_date_out,
  round(o.discount_percent)::integer                as agbis_discount,
  null::integer                                     as agbis_debet,
  null::integer                                     as agbis_dolg,
  b.manager_name                                    as agbis_user_name,
  b.addr                                            as address,
  o.created_at,
  b.has_trip                                        as has_trip
from public.orders o
left join lateral public.order_list_brief(o.client_id, o.manager_id, o.id) b on true

union all

select
  oh.id,
  oh.client_id,
  hb.client_name,
  hb.client_phone,
  'history'::text,
  oh.order_date,
  oh.amount,
  oh.agbis_status_name,
  oh.agbis_doc_num,
  oh.agbis_dor_id,
  oh.service,
  oh.agbis_date_out::text,
  oh.agbis_discount::integer,
  oh.agbis_debet,
  oh.agbis_dolg,
  oh.agbis_user_name,
  oh.address,
  oh.created_at,
  null::boolean                                     as has_trip
from public.order_history oh
left join lateral public.order_list_brief(oh.client_id, null::uuid, oh.id) hb on true
where not exists (
  select 1 from public.orders o2
  where o2.agbis_order_id is not null
    and o2.agbis_order_id = oh.agbis_dor_id
);

grant select on public.orders_unified to authenticated;

commit;
