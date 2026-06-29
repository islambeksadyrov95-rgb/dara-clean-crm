-- Cancelled orders were resurfacing in orders_unified as their STALE Agbis history mirror
-- (agbis_status_name still 'Новый'), so a cancelled order looked active again after refresh.
--
-- Root cause (from 20260628000002): the dedup "history row duplicates a live CRM order" required
-- o2.cancelled_at IS NULL. When a CRM order is cancelled it leaves the CRM branch AND stops
-- suppressing its history mirror, so the pre-cancel snapshot (status 'Новый') pops back into the list.
--
-- Decision D-2026-06-29-cancelled-visible: a cancelled order STAYS in the list, shown with its real
-- status 'Отменённый' — taken from the authoritative public.orders row, never from the stale mirror.
--   1. CRM branch: drop the `o.cancelled_at IS NULL` filter → cancelled CRM orders are shown
--      (orders.agbis_status_name is already 'Отменённый' after a cancel, so the badge is correct).
--   2. History dedup: drop `AND o2.cancelled_at IS NULL` → a CRM order (cancelled or not) always
--      suppresses its Agbis mirror, so the stale 'Новый' duplicate can never resurface.
--
-- Revenue is unchanged: recalc_client_aggregates still excludes cancelled orders from orders_agg
-- (cancelled = 0 revenue) — this migration only touches the display VIEW, not the aggregates.
-- create-or-replace (same columns, same types) → preserves the SELECT grant + fn_orders_list_totals.
-- DOWN: re-apply 20260628000002 (view with both cancel filters).
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
  coalesce(o.intake_date::date, o.created_at::date) as order_date,
  o.amount,
  o.agbis_status_name,
  o.agbis_doc_num,
  o.agbis_order_id                                  as agbis_dor_id,
  nullif(array_to_string(o.services, ', '), '')     as service,
  to_char(o.delivery_date, 'YYYY-MM-DD')            as agbis_date_out,
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
    and o2.agbis_order_id = oh.agbis_dor_id          -- any CRM order (cancelled or not) hides its mirror
);

grant select on public.orders_unified to authenticated;

commit;
