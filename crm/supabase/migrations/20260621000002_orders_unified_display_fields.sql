-- Fix orders list (orders_unified) display + manager visibility — 3 issues:
--   #3 «Приёмщик» пустой для CRM-заказов (agbis_user_name был null::text).
--   #4 «Адрес» пустой (address был null::text — клиентский адрес/адрес выезда не выводился).
--   #5 Менеджер видит заказ только если видит КЛИЕНТА. Причина: view security_invoker +
--      `join clients` под RLS clients (assigned_manager_id = auth.uid()). orders уже видны всем
--      менеджерам (20260620000001), но inner join re-гейтил список по назначению клиента —
--      менеджеры не видели даже собственные заказы для чужих клиентов.
--
-- Подход: security-definer helper отдаёт ИМЯ/телефон клиента, имя менеджера (приёмщик) и адрес
-- выезда в обход per-table RLS (это display-поля заказа, который и так виден по orders RLS).
-- `join clients` заменён на `left join lateral helper` → строка заказа больше не гейтится
-- видимостью клиента. Видимость самих заказов остаётся под orders RLS (invoker, «все менеджеры»).
-- RLS таблицы clients (страница «Клиенты») НЕ меняется — правка точечная, только список заказов.
--
-- DOWN: drop view; recreate from 20260620000003 (agbis_user_name/address = null, join clients);
--       drop function order_list_brief.
-- Created: 2026-06-21

begin;

-- Display brief: client name/phone, manager (приёмщик) name, trip/client address — bypassing
-- per-row RLS of clients/profiles/order_trips (definer). Used only by orders_unified for the
-- already-visible order row; never exposes the full tables (lookups are by id passed from the row).
create or replace function public.order_list_brief(p_client_id uuid, p_manager_id uuid, p_order_id uuid)
returns table (client_name text, client_phone text, manager_name text, addr text)
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
    )
$$;
revoke execute on function public.order_list_brief(uuid, uuid, uuid) from public, anon;
grant  execute on function public.order_list_brief(uuid, uuid, uuid) to authenticated;

drop view if exists public.orders_unified;

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
  b.manager_name                                    as agbis_user_name,  -- #3 приёмщик из CRM
  b.addr                                            as address,          -- #4 адрес выезда/клиента
  o.created_at
from public.orders o
-- #5: было `join clients` (гейтил по RLS клиента) → lateral definer brief, заказ не теряется
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
  oh.agbis_user_name,   -- история уже несёт приёмщика/адрес из снимка Агбиса
  oh.address,
  oh.created_at
from public.order_history oh
left join lateral public.order_list_brief(oh.client_id, null::uuid, oh.id) hb on true
where not exists (
  select 1 from public.orders o2
  where o2.agbis_order_id is not null
    and o2.agbis_order_id = oh.agbis_dor_id
);

grant select on public.orders_unified to authenticated;

commit;
