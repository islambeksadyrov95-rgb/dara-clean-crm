-- Словарь услуг для фильтра «Услуга в заказах»: distinct по order_history.service.
-- RPC вместо вытягивания всей колонки на сервер приложения.
--
-- DOWN: drop function if exists public.distinct_order_services();

create or replace function public.distinct_order_services()
returns table (service text)
language sql stable as $$
  select distinct oh.service
  from public.order_history oh
  where oh.service is not null and oh.service <> ''
  order by 1
$$;
