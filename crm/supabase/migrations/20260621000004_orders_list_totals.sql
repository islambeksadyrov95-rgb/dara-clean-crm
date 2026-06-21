-- Totals for the orders list (/orders): Σ amount + Σ carpet count + order count over the WHOLE
-- current filter set (not just the visible page). Powers the summary block under the table so the
-- owner/manager can reconcile a day against Agbis desktop.
--
-- Why an RPC (not a view column / PostgREST aggregate):
--   * Supabase disables PostgREST aggregate functions → cannot `.select('amount.sum()')`.
--   * Fetching the whole filtered set to sum in JS is unbounded (history ~7k rows) — database.md
--     forbids unbounded result sets.
--   * carpet_count is an expensive correlated subquery; putting it on orders_unified would re-run it
--     on every list render AND on fetchOrderManagers (scans all rows). Computing it ONLY here keeps
--     it off the hot read paths. orders_unified stays untouched (20260621000003).
--
-- RLS — the subtle part:
--   * fn_orders_list_totals is SECURITY INVOKER and reads orders_unified (also security_invoker), so a
--     manager aggregates exactly the orders they can SEE in the list (deal_visibility 20260620000001 =
--     all employees see all orders; admin sees all).
--   * carpet count, however, lives in order_items / order_history_items whose RLS is per-CREATOR
--     (o.manager_id = auth.uid()) / per-assigned-client. Counting it under the invoker would
--     UNDER-count for a manager (they see the order but not another manager's line items) → the
--     summary would show e.g. «2 заказа · 1 ковёр», inconsistent with the count/sum. Verified live:
--     elena saw 2 orders but only 1 carpet on 2026-06-21.
--   * Fix: count carpets via SECURITY DEFINER helper order_carpet_count(source, id). It is keyed by a
--     single order id that already passed the invoker WHERE on orders_unified (i.e. an order the user
--     is authorized to see), so the total stays consistent with the list and leaks nothing the list
--     does not already show. Same posture as order_list_brief (20260621000002) — a carpet-count
--     integer is strictly less sensitive than the name/phone that helper already exposes.
--
-- Carpet count (business rule, confirmed 2026-06-21):
--   * CRM order  = sum(order_items.qty) — exact (every order_items row is a carpet; addons are nested
--     jsonb, not rows; the «нулевой ковёр» is a row with agbis_tovar_id='100387', qty 1).
--   * History    = order_history_items carpet lines when present (kfx set OR name ~ «ковёр»),
--     else best-effort 1 if the service text mentions «ковёр». UI labels history as approximate.
--
-- Filters mirror fetchOrdersList (orders-query.ts) 1:1. The service ILIKE pattern is resolved in JS
-- (SERVICE_ILIKE) and passed in as p_service_pattern, so that mapping stays single-sourced in JS.
--
-- DOWN migration (manual rollback):
--   drop function if exists public.fn_orders_list_totals(text,text,text,text,text,text,text);
--   drop function if exists public.order_carpet_count(text, uuid);
-- Created: 2026-06-21

begin;

-- carpet count for ONE order, bypassing order_items / order_history_items RLS (definer). Keyed by id —
-- callers only ever pass ids of orders already authorized by the invoker filter in fn_orders_list_totals.
create or replace function public.order_carpet_count(p_source text, p_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_source = 'crm' then
      coalesce((select sum(oi.qty)::int from public.order_items oi where oi.order_id = p_id), 0)
    else
      coalesce(
        nullif((
          select sum(coalesce(ohi.qty, 1))::int
          from public.order_history_items ohi
          where ohi.order_history_id = p_id
            and (ohi.kfx is not null or ohi.name ilike '%ковер%' or ohi.name ilike '%ковёр%')
        ), 0),
        (select case when oh.service ilike '%ковер%' or oh.service ilike '%ковёр%' then 1 else 0 end
         from public.order_history oh where oh.id = p_id)
      )
  end
$$;
revoke execute on function public.order_carpet_count(text, uuid) from public, anon;
grant  execute on function public.order_carpet_count(text, uuid) to authenticated;

create or replace function public.fn_orders_list_totals(
  p_search          text default null,
  p_service_pattern text default null,
  p_status          text default null,
  p_manager         text default null,
  p_payment         text default null,
  p_date_from       text default null,
  p_date_to         text default null
)
returns table (order_count bigint, total_amount bigint, total_carpets bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(u.amount), 0)::bigint,
    coalesce(sum(public.order_carpet_count(u.source, u.id)), 0)::bigint
  from public.orders_unified u
  where (coalesce(p_search, '') = ''
         or u.client_name  ilike '%' || p_search || '%'
         or u.client_phone ilike '%' || p_search || '%')
    and (coalesce(p_service_pattern, '') = '' or u.service ilike p_service_pattern)
    and (coalesce(p_status, '')  = '' or u.agbis_status_name = p_status)
    and (coalesce(p_manager, '') = '' or u.agbis_user_name  = p_manager)
    and (coalesce(p_payment, '') = ''
         or (p_payment = 'debt' and coalesce(u.agbis_dolg, 0) > 0)
         or (p_payment = 'paid' and coalesce(u.agbis_dolg, 0) = 0))
    and (coalesce(p_date_from, '') = '' or u.order_date >= p_date_from::date)
    and (coalesce(p_date_to, '')   = '' or u.order_date <= p_date_to::date)
$$;

revoke execute on function public.fn_orders_list_totals(text,text,text,text,text,text,text) from public, anon;
grant  execute on function public.fn_orders_list_totals(text,text,text,text,text,text,text) to authenticated;

commit;
