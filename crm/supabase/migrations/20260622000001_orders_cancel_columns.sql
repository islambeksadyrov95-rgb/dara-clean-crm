-- Отмена заказа (CRM-намерение). Карточка пишет флаг cancel_requested + причину + коммент;
-- локальный binding/agent.py исполняет сырую Firebird-отмену (docs/integrations/agbis-api/
-- CANCEL-FEATURE-RND.md) и зеркалит cancelled_at + статус Отменённый. ТОЛЬКО неоплаченные
-- (raw минует реверс оплат/бонусов) — гард в canCancelOrder + авторитетно в агенте.
--
-- Только таблица orders: карточка читает orders напрямую (order-detail.ts), поэтому
-- orders_unified НЕ трогаем (view селектит конкретные колонки → добавление не ломает его).
-- cancel_reason = RETURN_KIND_ID (7 «Отказ клиента», 8 «Ошибка оформления»), не статус.
--
-- DOWN: drop index idx_orders_cancel_pending, idx_orders_cancelled_by;
--       alter table orders drop constraint chk_orders_cancel_reason,
--       drop column cancelled_by, cancelled_at, cancel_comment, cancel_reason, cancel_requested.
-- Created: 2026-06-22

begin;

alter table public.orders
  add column cancel_requested boolean not null default false,
  add column cancel_reason    smallint,
  add column cancel_comment   text,
  add column cancelled_at      timestamptz,
  add column cancelled_by      uuid references public.profiles(id);

alter table public.orders
  add constraint chk_orders_cancel_reason
  check (cancel_reason is null or cancel_reason in (7, 8));

-- Поллинг агента: запрошена отмена, но ещё не исполнена.
create index idx_orders_cancel_pending on public.orders (created_at)
  where cancel_requested = true and cancelled_at is null;

-- FK-индекс (database.md: FK без индекса запрещён).
create index idx_orders_cancelled_by on public.orders (cancelled_by);

commit;
