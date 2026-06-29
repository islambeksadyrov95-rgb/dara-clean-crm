-- Agbis's order list lets you pick WHICH date the filter/sort uses: приём (intake), выдача (delivery),
-- выезд (trip). CRM only ever filtered by intake. Expose the trip date on the view and teach
-- fn_orders_list_totals a p_date_type so the orders page can offer the same selector.
--   trip_date = earliest order_trips.trip_date for a CRM order (the "Забрать" выезд); null for
--   history-origin rows (no CRM trips). create-or-replace keeps columns additive + the SELECT grant.
-- Rebuilds the view on 20260629000003 (Almaty dates) + adds trip_date; drops/recreates the RPC (9 args).
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
  oh.address,
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

drop function if exists public.fn_orders_list_totals(text, text, text, text, text, text, text, boolean);

create or replace function public.fn_orders_list_totals(
  p_search          text    default null,
  p_service_pattern text    default null,
  p_status          text    default null,
  p_manager         text    default null,
  p_payment         text    default null,
  p_date_from       text    default null,
  p_date_to         text    default null,
  p_include_cancelled boolean default false,
  p_date_type       text    default 'intake'
)
returns table(order_count bigint, total_amount bigint, total_carpets bigint)
language sql
stable
set search_path to 'public'
as $function$
  select
    count(*)::bigint,
    coalesce(sum(u.amount), 0)::bigint,
    coalesce(sum(public.order_carpet_count(u.source, u.id)), 0)::bigint
  from public.orders_unified u
  cross join lateral (
    select case coalesce(p_date_type, 'intake')
             when 'delivery' then nullif(u.agbis_date_out, '')::date
             when 'trip'     then u.trip_date
             else u.order_date
           end as filter_date
  ) d
  where (coalesce(p_search, '') = ''
         or u.client_name  ilike '%' || p_search || '%'
         or u.client_phone ilike '%' || p_search || '%')
    and (coalesce(p_service_pattern, '') = '' or u.service ilike p_service_pattern)
    and (coalesce(p_status, '')  = '' or u.agbis_status_name = p_status)
    and (coalesce(p_manager, '') = '' or u.agbis_user_name  = p_manager)
    and (coalesce(p_payment, '') = ''
         or (p_payment = 'debt' and coalesce(u.agbis_dolg, 0) > 0)
         or (p_payment = 'paid' and coalesce(u.agbis_dolg, 0) = 0))
    and (coalesce(p_date_from, '') = '' or d.filter_date >= p_date_from::date)
    and (coalesce(p_date_to, '')   = '' or d.filter_date <= p_date_to::date)
    and (p_include_cancelled
         or coalesce(p_status, '') <> ''
         or u.agbis_status_name is distinct from 'Отменённый')
$function$;

grant execute on function public.fn_orders_list_totals(text, text, text, text, text, text, text, boolean, text) to authenticated;

commit;
