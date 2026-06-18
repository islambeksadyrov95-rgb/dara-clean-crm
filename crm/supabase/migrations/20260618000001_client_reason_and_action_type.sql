-- clients.next_action_type + clients.last_call_reason — модель «звонок→задача» (CALL-TASK-SYSTEM-SPEC §6, §8.8).
-- next_action_type: тип запланированной задачи (бейдж в строке очереди §5). Значение вычисляет
--   computeNextAction (callback|retry), пишет recordDisposition (applyClientDisposition).
-- last_call_reason: каноническая причина ПОСЛЕДНЕГО контакта (фильтр «Причина» в списке клиентов §8.8).
--   Отказ → код из decline_* sub_status; перезвон → опц. тег-причина. Коды: lib/call-status.ts CALL_REASONS.
-- view client_segments пересоздаётся с обеими колонками (бейдж очереди + фильтр на ветке сегмента).
-- База view — 20260612000011_view_acquisition_column.sql (security_invoker, исключение declined/not_relevant).
-- RLS unchanged: колонки на существующей таблице — политики уже покрывают clients; view = security_invoker.
--
-- DOWN (manual rollback):
--   drop index if exists public.idx_clients_last_call_reason;
--   alter table public.clients drop column if exists last_call_reason, drop column if exists next_action_type;
--   -- затем пересоздать view из 20260612000011_view_acquisition_column.sql (без двух новых колонок)
--
-- After apply: npm run gen:types (clients + client_segments Row types меняются).

begin;

alter table public.clients
  add column if not exists next_action_type text
    check (next_action_type in ('callback', 'retry')),
  add column if not exists last_call_reason text
    check (last_call_reason in (
      'expensive', 'competitor', 'not_needed', 'quality', 'season',
      'thinking', 'consulting', 'no_money', 'other'
    ));

-- Фильтр «Причина» бьёт по last_call_reason (.in). Партиал-индекс: значимы только непустые.
create index if not exists idx_clients_last_call_reason
  on public.clients (last_call_reason) where last_call_reason is not null;

-- view с новыми колонками (база — 20260612000011, добавлены next_action_type + last_call_reason).
drop view if exists public.client_segments;

create view public.client_segments with (security_invoker = true) as
with last_calls as (
  select distinct on (client_id) client_id, status
  from public.call_logs
  order by client_id, created_at desc
)
select
  c.id,
  c.name,
  c.phone,
  c.address,
  c.total_orders,
  c.total_spent,
  c.avg_order_value,
  c.last_order_date,
  c.last_called_at,
  c.locked_by,
  c.locked_until,
  c.assigned_manager_id,
  c.segment_override,
  c.next_action_at,
  c.next_action_type,
  c.last_call_reason,
  c.sticky_note,
  c.created_at,
  c.acquisition_source_id,
  coalesce(c.segment_override, public.compute_segment(c.total_orders, c.last_order_date)) as rfm_segment,
  case
    when c.last_order_date is not null then (current_date - c.last_order_date)
    else null
  end as days_since_last_order
from public.clients c
left join last_calls lc on lc.client_id = c.id
where lc.status is null or (lc.status != 'declined' and lc.status != 'not_relevant');

-- Backfill: проставить существующим клиентам тип задачи и причину последнего контакта из недавней истории.
-- Зеркалит lib/call-status.ts deriveLastCallReason + computeNextAction.nextActionType (для согласованности с движком).
with last_log as (
  select distinct on (client_id) client_id, status, sub_status, reason
  from public.call_logs
  order by client_id, created_at desc
)
update public.clients c set
  next_action_type = case
    when c.next_action_at is null then null
    when l.status = 'callback' then 'callback'
    when l.status = 'not_reached' and l.sub_status = 'unavailable' then 'retry'
    else null
  end,
  last_call_reason = case
    when l.status = 'declined' then case l.sub_status
      when 'decline_expensive' then 'expensive'
      when 'decline_competitor' then 'competitor'
      when 'decline_not_needed' then 'not_needed'
      when 'decline_quality' then 'quality'
      when 'decline_season' then 'season'
      else 'other'
    end
    when l.status = 'callback' and l.reason in ('thinking', 'consulting', 'no_money', 'competitor', 'season')
      then l.reason
    else null
  end
from last_log l
where l.client_id = c.id;

commit;
