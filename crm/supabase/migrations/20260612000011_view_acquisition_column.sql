-- Фильтр «Источник» на /queue работает через view client_segments —
-- добавляем acquisition_source_id в view (создан в 20260612000008).
--
-- DOWN: re-run view definition from 20260612000006_view_filter_columns.sql
-- After apply: npm run gen:types.

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
  c.acquisition_source_id,
  coalesce(c.segment_override, public.compute_segment(c.total_orders, c.last_order_date)) as rfm_segment,
  case
    when c.last_order_date is not null then (current_date - c.last_order_date)
    else null
  end as days_since_last_order
from public.clients c
left join last_calls lc on lc.client_id = c.id
where lc.status is null or (lc.status != 'declined' and lc.status != 'not_relevant');

commit;
