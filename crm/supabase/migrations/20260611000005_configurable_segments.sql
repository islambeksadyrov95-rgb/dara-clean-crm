-- Migration: configurable RFM segments (admin-editable names + thresholds)
--
-- WHAT: segment names, colors and thresholds become data (crm_settings.segment_rules)
-- instead of being hardcoded in the SQL view and the app. A per-client manual override
-- (clients.segment_override) takes precedence over the auto-computed segment; when it is
-- NULL the segment is computed live from order count + days since last order, using the
-- admin-configured rules. No freezing: every client auto-updates unless explicitly
-- overridden by hand.
-- Created: 2026-06-11

-- ============================================================
-- 1. Manual override column (NULL = auto)
-- ============================================================
alter table public.clients add column if not exists segment_override text;

-- ============================================================
-- 2. Default rules in crm_settings (idempotent — keeps existing config if present).
--    Ordered list: first matching rule wins. type = days_gt | orders_gte | default.
-- ============================================================
insert into public.crm_settings (key, value, updated_at)
values (
  'segment_rules',
  '{"segments":[
    {"name":"Потерянный","color":"bg-red-50 text-red-700 border-red-100","type":"days_gt","value":180},
    {"name":"В риске","color":"bg-amber-50 text-amber-700 border-amber-100","type":"days_gt","value":90},
    {"name":"Постоянный","color":"bg-emerald-50 text-emerald-700 border-emerald-100","type":"orders_gte","value":4},
    {"name":"Повторный","color":"bg-teal-50 text-teal-700 border-teal-100","type":"orders_gte","value":2},
    {"name":"Новый","color":"bg-blue-50 text-blue-700 border-blue-100","type":"default","value":0}
  ]}'::jsonb,
  now()
)
on conflict (key) do nothing;

-- ============================================================
-- 3. compute_segment(): evaluate the configured rules in order, first match wins.
--    STABLE so the planner can cache within a statement.
-- ============================================================
create or replace function public.compute_segment(p_total_orders integer, p_last_order_date date)
returns text language plpgsql stable as $$
declare
  v_rules jsonb;
  v_seg jsonb;
  v_days integer;
  v_type text;
  v_value integer;
begin
  select value into v_rules from public.crm_settings where key = 'segment_rules';
  if v_rules is null or v_rules -> 'segments' is null then
    return 'Новый';
  end if;

  if p_last_order_date is not null then
    v_days := current_date - p_last_order_date;
  end if;

  for v_seg in select jsonb_array_elements(v_rules -> 'segments') loop
    v_type := v_seg ->> 'type';
    v_value := coalesce((v_seg ->> 'value')::integer, 0);
    if v_type = 'days_gt' and v_days is not null and v_days > v_value then
      return v_seg ->> 'name';
    elsif v_type = 'orders_gte' and p_total_orders >= v_value then
      return v_seg ->> 'name';
    elsif v_type = 'default' then
      return v_seg ->> 'name';
    end if;
  end loop;

  return 'Новый';
end;
$$;

-- ============================================================
-- 4. Recreate client_segments: override wins, else compute_segment.
--    Keeps security_invoker = true (RLS respected) and the active-clients filter.
-- ============================================================
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
