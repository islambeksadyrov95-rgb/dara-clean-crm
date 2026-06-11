-- Migration: recalc_client_aggregates RPC — server-side bulk aggregate recompute
-- Replaces JS-side per-client UPDATE fan-out (up to 500 parallel REST calls on 4.5k
-- clients → connection-limit / serverless flakiness). One SQL UPDATE per chunk instead.
-- Recomputes total_orders / total_spent / avg_order_value / last_order_date for the
-- given client ids from order_history (ALL sources) + live public.orders.
-- Money: all sums integer (WHOLE TENGE) per database.md (money = integer).
-- security definer + revoke from public/anon/authenticated → only service role (admin
-- client) can call it; the function body never leaks its definer privileges to callers.
-- Created: 2026-06-12
--
-- DOWN migration (manual rollback):
--   DROP FUNCTION IF EXISTS public.recalc_client_aggregates(uuid[]);

-- ============================================================
-- recalc_client_aggregates — bulk recompute aggregates for client ids
-- ============================================================
create or replace function public.recalc_client_aggregates(p_client_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  -- Aggregate order_history (all sources) per client.
  with history_agg as (
    select
      oh.client_id,
      count(*)::int            as cnt,
      coalesce(sum(oh.amount), 0)::int as spent,
      max(oh.order_date)       as last_date
    from public.order_history oh
    where oh.client_id = any(p_client_ids)
    group by oh.client_id
  ),
  -- Aggregate live orders per client (created_at::date as the order date).
  orders_agg as (
    select
      o.client_id,
      count(*)::int            as cnt,
      coalesce(sum(o.amount), 0)::int as spent,
      max(o.created_at::date)  as last_date
    from public.orders o
    where o.client_id = any(p_client_ids)
    group by o.client_id
  ),
  -- LEFT JOIN from the requested ids so clients WITHOUT any orders get 0/0/0/null.
  combined as (
    select
      ids.client_id,
      coalesce(h.cnt, 0) + coalesce(ord.cnt, 0)        as total_orders,
      coalesce(h.spent, 0) + coalesce(ord.spent, 0)    as total_spent,
      greatest(h.last_date, ord.last_date)             as last_order_date
    from unnest(p_client_ids) as ids(client_id)
    left join history_agg h on h.client_id = ids.client_id
    left join orders_agg ord on ord.client_id = ids.client_id
  )
  update public.clients c
  set
    total_orders    = combined.total_orders,
    total_spent     = combined.total_spent,
    avg_order_value = case
                        when combined.total_orders > 0
                          then round(combined.total_spent::numeric / combined.total_orders)::int
                        else 0
                      end,
    last_order_date = combined.last_order_date,
    updated_at      = now()
  from combined
  where c.id = combined.client_id;
$$;

-- Only the service role (admin client) may call this; revoke from everyone else.
revoke execute on function public.recalc_client_aggregates(uuid[]) from public, anon, authenticated;
