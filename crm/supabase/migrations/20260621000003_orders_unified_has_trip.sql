-- Add «Есть выезд» indicator to the orders list (mirror Agbis desktop column).
-- has_trip = у CRM-заказа есть строки order_trips (забор/доставка). История (импорт) выездов в
-- нашей схеме не несёт → null (бейдж «—»). Считается в том же security-definer helper, что и адрес
-- (обходит RLS order_trips — заказ уже виден по orders RLS). Меняется return type функции →
-- drop view → drop function → recreate обоих. Тело view = 20260621000002 + колонка has_trip в конце.
--
-- DOWN: recreate from 20260621000002 (helper без has_trip, view без колонки).
-- Created: 2026-06-21

begin;

drop view if exists public.orders_unified;
drop function if exists public.order_list_brief(uuid, uuid, uuid);

create function public.order_list_brief(p_client_id uuid, p_manager_id uuid, p_order_id uuid)
returns table (client_name text, client_phone text, manager_name text, addr text, has_trip boolean)
language sql
security definer
stable
set search_path = public
as $$
  select
    (select c.name  from public.clients  c  where c.id = p_client_id),
    (select c.phone from public.clients  c  where c.id = p_client_id),
    (select pr.name from public.profiles pr where pr.id = p_manager_id),
    coalesce(
      (select t.address from public.order_trips t
         where t.order_id = p_order_id and t.kind = 'pickup'
         order by t.created_at limit 1),
      (select c.address from public.clients c where c.id = p_client_id)
    ),
    exists(select 1 from public.order_trips t where t.order_id = p_order_id)
$$;
revoke execute on function public.order_list_brief(uuid, uuid, uuid) from public, anon;
grant  execute on function public.order_list_brief(uuid, uuid, uuid) to authenticated;

create view public.orders_unified
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
  b.has_trip                                        as has_trip   -- #2 «Есть выезд» (CRM)
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
  null::boolean                                     as has_trip   -- история выездов не несёт
from public.order_history oh
left join lateral public.order_list_brief(oh.client_id, null::uuid, oh.id) hb on true
where not exists (
  select 1 from public.orders o2
  where o2.agbis_order_id is not null
    and o2.agbis_order_id = oh.agbis_dor_id
);

grant select on public.orders_unified to authenticated;

commit;
