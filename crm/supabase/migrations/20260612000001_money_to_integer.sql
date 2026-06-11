-- Migration: money columns -> integer (whole tenge, no tiyn)
-- Rule: database.md §Money — never float/fractional for money. Decision: integer
-- KZT (целые тенге), NOT smallest-unit tiyn (EXECUTION-PLAN «Вне скоупа»).
-- discount_percent stays numeric(5,2) — it is a percentage, not money.
-- Pre-migration state (2026-06-12): 10 clients + 1 order had fractional values;
-- snapshot taken (.snapshots/2026-06-12-pre-F2-*.json), sum(total_spent)=7312474.50.
--
-- client_segments view depends on clients.total_spent -> drop & recreate around ALTER.
--
-- DOWN (manual rollback):
--   drop view public.client_segments;
--   alter table public.clients
--     alter column total_spent type numeric(12,2) using total_spent::numeric(12,2),
--     alter column avg_order_value type numeric(12,2) using avg_order_value::numeric(12,2);
--   alter table public.orders
--     alter column amount type numeric(12,2) using amount::numeric(12,2),
--     alter column discount_amount type numeric(12,2) using discount_amount::numeric(12,2);
--   alter table public.sales_plans
--     alter column carpets_target type numeric(12,2) using carpets_target::numeric(12,2),
--     alter column furniture_target type numeric(12,2) using furniture_target::numeric(12,2),
--     alter column curtains_target type numeric(12,2) using curtains_target::numeric(12,2),
--     alter column repeat_target type numeric(12,2) using repeat_target::numeric(12,2),
--     alter column dry_clean_target type numeric(12,2) using dry_clean_target::numeric(12,2),
--     alter column blankets_target type numeric(12,2) using blankets_target::numeric(12,2);
--   then recreate the view (same definition as below).
--   Fractional tails lost to round() are only recoverable from the snapshot.

begin;

drop view if exists public.client_segments;

alter table public.clients
  alter column total_spent type integer using round(total_spent)::integer,
  alter column avg_order_value type integer using round(avg_order_value)::integer;

alter table public.orders
  alter column amount type integer using round(amount)::integer,
  alter column discount_amount type integer using round(discount_amount)::integer;

alter table public.sales_plans
  alter column carpets_target type integer using round(carpets_target)::integer,
  alter column furniture_target type integer using round(furniture_target)::integer,
  alter column curtains_target type integer using round(curtains_target)::integer,
  alter column repeat_target type integer using round(repeat_target)::integer,
  alter column dry_clean_target type integer using round(dry_clean_target)::integer,
  alter column blankets_target type integer using round(blankets_target)::integer;

-- Recreate view verbatim from 20260611000005_configurable_segments.sql
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
  c.last_order_date,
  c.last_called_at,
  c.locked_by,
  c.locked_until,
  c.assigned_manager_id,
  c.segment_override,
  coalesce(c.segment_override, public.compute_segment(c.total_orders, c.last_order_date)) as rfm_segment,
  case
    when c.last_order_date is not null then (current_date - c.last_order_date)
    else null
  end as days_since_last_order
from public.clients c
left join last_calls lc on lc.client_id = c.id
where lc.status is null or (lc.status != 'declined' and lc.status != 'not_relevant');

commit;
