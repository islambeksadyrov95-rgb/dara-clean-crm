-- Migration: recalc_client_aggregates — DEDUP cross-table double-count (Agbis)
-- An Agbis order can exist BOTH as a live order (public.orders.agbis_order_id) AND as an
-- imported mirror (public.order_history.agbis_dor_id). The prior recalc summed both tables
-- unconditionally → that order's amount was counted TWICE in clients.total_spent / total_orders.
-- Fix: when aggregating order_history, EXCLUDE rows whose agbis_dor_id matches a live order's
-- agbis_order_id (the same physical Agbis order). The live order wins (it carries manager_id +
-- KPI state); the redundant history mirror is dropped from the aggregate. Manual / non-Agbis
-- history rows (agbis_dor_id IS NULL) are ALWAYS kept (NULL never equals a value).
-- Lookup uses uq_orders_agbis_order_id + uq_order_history_agbis_dor (both partial-unique) → 1:1,
-- no row multiplication, index-backed.
-- DDL only (function replace; create-or-replace preserves the existing REVOKE grant — re-stated
-- below for explicitness). Stored aggregates are refreshed by a SEPARATE recalc step after apply.
-- Money: all sums integer (WHOLE TENGE) per database.md (money = integer).
-- Created: 2026-06-16
--
-- DOWN migration (manual rollback): re-apply 20260612000003_recalc_aggregates_rpc.sql
--   (restores the non-dedup version of this function), then recalc affected clients.

-- ============================================================
-- recalc_client_aggregates — bulk recompute aggregates, deduped across orders/order_history
-- ============================================================
create or replace function public.recalc_client_aggregates(p_client_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  -- Aggregate order_history per client, EXCLUDING rows that duplicate a live order
  -- (same Agbis order present in both tables → counted once, via public.orders below).
  with history_agg as (
    select
      oh.client_id,
      count(*)::int            as cnt,
      coalesce(sum(oh.amount), 0)::int as spent,
      max(oh.order_date)       as last_date
    from public.order_history oh
    where oh.client_id = any(p_client_ids)
      and not exists (
        select 1 from public.orders o
        where o.agbis_order_id is not null
          and o.agbis_order_id = oh.agbis_dor_id
      )
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

-- Only the service role (admin client) may call this; revoke from everyone else (idempotent).
revoke execute on function public.recalc_client_aggregates(uuid[]) from public, anon, authenticated;
