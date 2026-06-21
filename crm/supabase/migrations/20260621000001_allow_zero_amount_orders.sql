-- Allow zero-amount orders (нулевой ковёр / order without обмер).
--
-- Bug: create_order_with_items rejected p_amount <= 0 with 'invalid_amount'. This made the
-- "нулевой ковёр" placeholder feature (commit 966ba65 — a carpet priced 0 ₸ until Agbis measures
-- it) impossible to submit when the carpet is the only line: subtotal = 0 → RPC raised, the UI
-- showed the generic "Не удалось создать заказ". A zero-total order is legitimate here — Agbis is
-- authoritative for the real carpet price (D1), computed after measurement.
--
-- Fix: relax the guard to reject only NEGATIVE amounts (data corruption), allow 0.
-- Signature unchanged → no type regeneration needed. Only the guard line differs from
-- 20260615000002_agbis_orders_schema.sql; the rest of the body is reproduced verbatim.
--
-- DOWN migration (manual rollback): re-create the function with the guard `p_amount <= 0`.
-- Created: 2026-06-21

begin;

create or replace function public.create_order_with_items(
  p_client_id        uuid,
  p_services         text[],
  p_amount           integer,
  p_discount_percent numeric default 0,
  p_discount_amount  integer default 0,
  p_comment          text default null,
  p_items            jsonb default '[]'::jsonb
)
returns table (order_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_order_id   uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- CHANGED: was `p_amount <= 0` — now allow a zero total (нулевой ковёр), reject only negatives.
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_services is null or array_length(p_services, 1) is null then
    raise exception 'no_services' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  insert into public.orders (
    client_id, manager_id, services, amount, discount_percent, discount_amount, comment
  )
  values (
    p_client_id, v_uid, p_services, p_amount,
    coalesce(p_discount_percent, 0), coalesce(p_discount_amount, 0), p_comment
  )
  returning orders.id, orders.created_at into v_order_id, v_created_at;

  -- Structured line items (optional; empty for legacy CRM orders without the new form).
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.order_items (
      order_id, agbis_tovar_id, name, qty, kfx, unit_price, line_amount, discount_percent, addons
    )
    select
      v_order_id,
      nullif(it ->> 'agbis_tovar_id', ''),
      it ->> 'name',
      coalesce((it ->> 'qty')::int, 1),
      nullif(it ->> 'kfx', '')::numeric,
      coalesce((it ->> 'unit_price')::int, 0),
      coalesce((it ->> 'line_amount')::int, 0),
      coalesce((it ->> 'discount_percent')::numeric, 0),
      it -> 'addons'  -- jsonb value, or SQL NULL when the key is absent
    from jsonb_array_elements(p_items) as it;
  end if;

  -- Preserve current behavior: auto-assign an unassigned client to the creating manager.
  update public.clients
    set assigned_manager_id = v_uid
    where id = p_client_id and assigned_manager_id is null;

  -- Aggregates: single source of truth, idempotent recompute (NOT +=).
  perform public.recalc_client_aggregates(array[p_client_id]);

  return query select v_order_id, v_created_at;
end;
$$;

-- create-or-replace preserves ACL, but re-assert it to stay explicit and idempotent.
revoke execute on function public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb)
  from public, anon;
grant execute on function public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb)
  to authenticated;

commit;
