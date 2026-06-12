-- RPC для фильтра «получил рассылку, но не заказал после неё»:
-- NOT EXISTS не выражается через PostgREST-фильтры, считаем на стороне БД.
-- Возвращает id клиентов, у которых последняя успешная рассылка за p_days дней
-- НЕ привела к заказу (ни в orders, ни в order_history после даты рассылки).
--
-- DOWN (manual rollback): drop function if exists public.broadcast_no_order_ids(integer);

create or replace function public.broadcast_no_order_ids(p_days integer default 90)
returns table (client_id uuid)
language sql stable as $$
  with last_broadcast as (
    select bl.client_id, max(bl.sent_at) as sent_at
    from public.broadcast_logs bl
    where bl.status = 'sent'
      and bl.sent_at >= now() - make_interval(days => p_days)
    group by bl.client_id
  )
  select lb.client_id
  from last_broadcast lb
  where not exists (
    select 1 from public.orders o
    where o.client_id = lb.client_id and o.created_at > lb.sent_at
  )
  and not exists (
    select 1 from public.order_history oh
    where oh.client_id = lb.client_id and oh.order_date::timestamptz > lb.sent_at
  )
$$;
