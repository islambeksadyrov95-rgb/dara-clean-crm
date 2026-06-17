-- Migration: broadcast_no_order_ids — детерминированный потолок выборки
-- Баг: RPC возвращала client_id без ORDER BY и без LIMIT. Вызывающий код (queue-query.ts)
-- срезал результат до 1000 строк через .slice(0, 1000) БЕЗ сортировки → какие именно 1000
-- клиентов попадут в фильтр «рассылка без заказа», зависело от недетерминированного порядка
-- строк PostgreSQL и могло меняться между рендерами (молчаливый плавающий cap).
-- Фикс: сортируем по client_id и ограничиваем выборку в самой функции. Порядок стабильный
-- (по PK клиента), LIMIT совпадает с BROADCAST_IDS_CAP в queue-query.ts. JS-срез оставлен
-- как backstop, но теперь набор строк уже детерминирован на стороне БД.
-- Чистый DDL (create or replace), данные не трогаем.
-- Created: 2026-06-17
--
-- DOWN (manual rollback): re-apply 20260612000010_broadcast_no_order_rpc.sql
--   (восстанавливает версию без ORDER BY/LIMIT).

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
  -- Детерминированный порядок + жёсткий потолок: один и тот же набор между рендерами.
  -- LIMIT синхронизирован с BROADCAST_IDS_CAP в app/(protected)/queue/queue-query.ts.
  order by lb.client_id
  limit 1000
$$;
