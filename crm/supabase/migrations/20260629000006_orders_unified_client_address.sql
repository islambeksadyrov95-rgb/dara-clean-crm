-- Agbis-origin orders (imported via read-sync into order_history) carry no address — the read-sync
-- pulls only the order header, and the address lives on the выезд (trip), which we don't read from
-- Agbis. Result: ~all read-synced orders showed an empty «Адрес». The client's registered address IS
-- synced (clients.address) and covers them, so fall back to it for the display list.
-- History branch only: address = coalesce(oh.address, client address). Rebuilds the view on
-- 20260629000005 (trip_date) — sole change is the history-branch address. RPC unchanged.
-- NOTE: the real выезд address/status/reschedules still need the Firebird binding agent to push
-- trip data into CRM — the Agbis order-read API exposes neither. This is the display-address stopgap.
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
  b.has_trip                                        as has_trip,
  (select min(t.trip_date) from public.order_trips t where t.order_id = o.id) as trip_date
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
  coalesce(oh.address, (select c.address from public.clients c where c.id = oh.client_id)) as address,
  oh.created_at,
  null::boolean                                     as has_trip,
  null::date                                        as trip_date
from public.order_history oh
left join lateral public.order_list_brief(oh.client_id, null::uuid, oh.id) hb on true
where not exists (
  select 1 from public.orders o2
  where o2.agbis_order_id is not null
    and o2.agbis_order_id = oh.agbis_dor_id
);

grant select on public.orders_unified to authenticated;

commit;
