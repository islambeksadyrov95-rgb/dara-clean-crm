-- The orders list hides cancelled orders by default (Agbis-style: shown only via a checkbox).
-- fn_orders_list_totals must mirror that, or the footer count diverges from the visible list.
-- Add p_include_cancelled: when false (default) AND no explicit status filter, exclude 'Отменённый';
-- an explicit status filter or p_include_cancelled=true disables the exclusion (status filter governs).
--
-- Adding a parameter changes the signature, so drop the 7-arg version and recreate with 8 args.
-- SECURITY INVOKER (default) + reads the security_invoker view → каждый видит только своё (RLS).
-- DOWN: re-apply 20260616-era fn_orders_list_totals (7 args, no cancelled handling).
-- Created: 2026-06-29

begin;

drop function if exists public.fn_orders_list_totals(text, text, text, text, text, text, text);

create or replace function public.fn_orders_list_totals(
  p_search          text    default null,
  p_service_pattern text    default null,
  p_status          text    default null,
  p_manager         text    default null,
  p_payment         text    default null,
  p_date_from       text    default null,
  p_date_to         text    default null,
  p_include_cancelled boolean default false
)
returns table(order_count bigint, total_amount bigint, total_carpets bigint)
language sql
stable
set search_path to 'public'
as $function$
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
    and (p_include_cancelled
         or coalesce(p_status, '') <> ''
         or u.agbis_status_name is distinct from 'Отменённый')
$function$;

grant execute on function public.fn_orders_list_totals(text, text, text, text, text, text, text, boolean) to authenticated;

commit;
