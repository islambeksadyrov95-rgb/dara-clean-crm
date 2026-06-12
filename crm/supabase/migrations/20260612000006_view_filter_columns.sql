-- FilterBar (этап 1): client_segments не содержал created_at / avg_order_value /
-- next_action_at / sticky_note — фильтры по этим полям не работали на ветке view
-- (фильтр по сегменту). Пересоздаём view с полным набором фильтруемых колонок.
-- Семантика не меняется: security_invoker + исключение отказников как раньше.
--
-- DOWN (manual rollback): re-run view definition from 20260612000001_money_to_integer.sql:49
--
-- After apply: npm run gen:types (view Row type changes).

begin;

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
  c.sticky_note,
  c.created_at,
  coalesce(c.segment_override, public.compute_segment(c.total_orders, c.last_order_date)) as rfm_segment,
  case
    when c.last_order_date is not null then (current_date - c.last_order_date)
    else null
  end as days_since_last_order
from public.clients c
left join last_calls lc on lc.client_id = c.id
where lc.status is null or (lc.status != 'declined' and lc.status != 'not_relevant');

commit;
