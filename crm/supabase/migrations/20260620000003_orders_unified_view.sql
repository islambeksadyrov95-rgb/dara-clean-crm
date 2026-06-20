-- Единый READ-слой для списка заказов: CRM-заказы (orders) ∪ импортированная история
-- (order_history). НЕ физическое слияние таблиц — две сущности остаются раздельными
-- (orders = заказ, созданный в CRM; order_history = снимок из Агбиса). View нужен только
-- для страницы /orders и карточки клиента, чтобы показать оба источника одним списком.
--
-- KPI/аналитика (dashboard/queue/motivation/pipeline/team) продолжают читать ФИЗИЧЕСКУЮ orders
-- по manager_id+created_at — их не трогаем, view их не касается.
--
-- security_invoker = on (PG17): RLS базовых таблиц (orders/order_history/clients) применяется
-- к вызывающему пользователю. Менеджер видит свои CRM-заказы + историю своих клиентов; admin — всё.
-- БЕЗ этого view выполнялся бы как owner и протёк бы все заказы всем — поэтому invoker обязателен.
--
-- Дедуп: история, чей agbis_dor_id совпадает с agbis_order_id живого CRM-заказа, исключается
-- (один заказ Агбиса показывается один раз, CRM-строка выигрывает). Та же логика, что в
-- recalc_client_aggregates (20260616000002) — не двойной счёт в списке.
--
-- Колонки названы под существующий тип Order в orders-query.ts (минимум изменений клиента):
-- agbis_date_out/agbis_discount/agbis_debet/agbis_dolg/agbis_user_name. Для CRM-заказов
-- payment-зеркало (debet/dolg), приёмщик и адрес = NULL в v1 (не зависим от дрейфующих колонок).

-- drop+create (а не create-or-replace): тип колонки скидки = integer, REPLACE смену типа запрещает.
drop view if exists public.orders_unified;

create view public.orders_unified
with (security_invoker = on) as
select
  o.id,
  o.client_id,
  c.name                                            as client_name,
  c.phone                                           as client_phone,
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
  null::text                                        as agbis_user_name,
  null::text                                        as address,
  o.created_at
from public.orders o
join public.clients c on c.id = o.client_id

union all

select
  oh.id,
  oh.client_id,
  c.name,
  c.phone,
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
  oh.created_at
from public.order_history oh
join public.clients c on c.id = oh.client_id
where not exists (
  select 1 from public.orders o2
  where o2.agbis_order_id is not null
    and o2.agbis_order_id = oh.agbis_dor_id
);

grant select on public.orders_unified to authenticated;
