-- Cancelled CRM orders must NOT count as revenue and must NOT clutter the orders list.
-- Today neither recalc_client_aggregates nor orders_unified filter cancelled orders, so a
-- cancelled CRM ghost still inflates clients.total_spent and shows as an active row. Fix both:
--
--   1. recalc_client_aggregates: orders_agg excludes o.cancelled_at IS NOT NULL.
--   2. orders_unified (CRM branch): excludes o.cancelled_at IS NOT NULL.
--   3. Dedup (both VIEW history branch AND recalc history_agg): the "history row duplicates a
--      live CRM order" check now requires o.cancelled_at IS NULL. So when a CRM order is cancelled
--      (and thus dropped from the CRM branch / orders_agg), its Agbis history mirror is NO LONGER
--      suppressed — it shows/counts instead of the order vanishing entirely. For a real cancel the
--      Agbis amount is 0 (ZERO_TOVARS) → history mirror counts 0 → correct (cancelled = no revenue).
--
-- The order DETAIL card reads public.orders directly (order-detail.ts), so a cancelled order is
-- still fully visible on its own page — only the LIST (orders_unified) and the revenue aggregates
-- drop it. See D-2026-06-28-cancelled-excluded.
--
-- Money: all sums integer (WHOLE TENGE) per database.md.
-- create-or-replace (same columns, same types) → preserves the SELECT grant + fn_orders_list_totals.
-- DOWN: re-apply 20260621000003 (view without cancel filter) + 20260616000002 (recalc without it).
-- Created: 2026-06-28

begin;

-- ============================================================
-- 1+3. recalc_client_aggregates — exclude cancelled CRM orders; dedup skips cancelled
-- ============================================================
create or replace function public.recalc_client_aggregates(p_client_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  with history_agg as (
    select
      oh.client_id,
      count(*)::int                    as cnt,
      coalesce(sum(oh.amount), 0)::int as spent,
      max(oh.order_date)               as last_date
    from public.order_history oh
    where oh.client_id = any(p_client_ids)
      and not exists (
        select 1 from public.orders o
        where o.agbis_order_id is not null
          and o.agbis_order_id = oh.agbis_dor_id
          and o.cancelled_at is null            -- cancelled CRM order no longer suppresses its mirror
      )
    group by oh.client_id
  ),
  orders_agg as (
    select
      o.client_id,
      count(*)::int                    as cnt,
      coalesce(sum(o.amount), 0)::int  as spent,
      max(o.created_at::date)          as last_date
    from public.orders o
    where o.client_id = any(p_client_ids)
      and o.cancelled_at is null                -- cancelled orders are not revenue
    group by o.client_id
  ),
  combined as (
    select
      ids.client_id,
      coalesce(h.cnt, 0) + coalesce(ord.cnt, 0)     as total_orders,
      coalesce(h.spent, 0) + coalesce(ord.spent, 0) as total_spent,
      greatest(h.last_date, ord.last_date)          as last_order_date
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

revoke execute on function public.recalc_client_aggregates(uuid[]) from public, anon, authenticated;

-- ============================================================
-- 2+3. orders_unified — exclude cancelled CRM orders; dedup skips cancelled
-- (exact body of 20260621000003 + the two cancel filters)
-- ============================================================
create or replace view public.orders_unified
with (security_invoker = on) as
select
  o.id,
  o.client_id,
  b.client_name                                     as client_name,
  b.client_phone                                    as client_phone,
  'crm'::text                                       as source,
  coalesce(o.intake_date::date, o.created_at::date) as order_date,
  o.amount,
  o.agbis_status_name,
  o.agbis_doc_num,
  o.agbis_order_id                                  as agbis_dor_id,
  nullif(array_to_string(o.services, ', '), '')     as service,
  to_char(o.delivery_date, 'YYYY-MM-DD')            as agbis_date_out,
  round(o.discount_percent)::integer                as agbis_discount,
  null::integer                                     as agbis_debet,
  null::integer                                     as agbis_dolg,
  b.manager_name                                    as agbis_user_name,
  b.addr                                            as address,
  o.created_at,
  b.has_trip                                        as has_trip
from public.orders o
left join lateral public.order_list_brief(o.client_id, o.manager_id, o.id) b on true
where o.cancelled_at is null                        -- cancelled CRM ghosts leave the active list

union all

select
  oh.id,
  oh.client_id,
  hb.client_name,
  hb.client_phone,
  'history'::text,
  oh.order_date,
  oh.amount,
  oh.agbis_status_name,
  oh.agbis_doc_num,
  oh.agbis_dor_id,
  oh.service,
  oh.agbis_date_out::text,
  oh.agbis_discount::integer,
  oh.agbis_debet,
  oh.agbis_dolg,
  oh.agbis_user_name,
  oh.address,
  oh.created_at,
  null::boolean                                     as has_trip
from public.order_history oh
left join lateral public.order_list_brief(oh.client_id, null::uuid, oh.id) hb on true
where not exists (
  select 1 from public.orders o2
  where o2.agbis_order_id is not null
    and o2.agbis_order_id = oh.agbis_dor_id
    and o2.cancelled_at is null                     -- cancelled CRM order no longer hides its mirror
);

grant select on public.orders_unified to authenticated;

commit;
