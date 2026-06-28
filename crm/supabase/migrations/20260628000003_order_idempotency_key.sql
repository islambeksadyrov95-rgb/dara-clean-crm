-- Idempotent order creation (plan step 3). A double-submit or a retry-after-timeout must NOT create
-- a second order. With the new durable enqueue (D-2026-06-28-enqueue-first) a timed-out createOrder
-- STILL persists+queues the order, so a user retry would duplicate it. Guard: the form generates one
-- idempotency_key per open; create_order_with_items returns the existing order for a repeat key.
--
-- orders.idempotency_key (nullable — legacy/other creators have none) + partial UNIQUE index so two
-- concurrent inserts with the same key can't both win (the loser catches unique_violation and returns
-- the winner's order). Check-first is the fast path; the index + handler are the race guard.
--
-- Signature CHANGES (adds p_idempotency_key) → regenerate types after apply.
-- DOWN: re-apply 20260621000001 (function without the param); drop index uq_orders_idempotency_key;
--       alter table orders drop column idempotency_key.
-- Created: 2026-06-28

begin;

alter table public.orders add column if not exists idempotency_key text;

create unique index if not exists uq_orders_idempotency_key
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- Adding a param creates a NEW overload — drop the old 7-arg one so PostgREST has a single candidate
-- (two overloads → "could not choose best candidate function"). createOrder is the only caller.
drop function if exists public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb);

create or replace function public.create_order_with_items(
  p_client_id        uuid,
  p_services         text[],
  p_amount           integer,
  p_discount_percent numeric default 0,
  p_discount_amount  integer default 0,
  p_comment          text default null,
  p_items            jsonb default '[]'::jsonb,
  p_idempotency_key  text default null
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
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_services is null or array_length(p_services, 1) is null then
    raise exception 'no_services' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  -- Idempotency fast path: this key already produced an order → return it, create nothing.
  if p_idempotency_key is not null then
    select o.id, o.created_at into v_order_id, v_created_at
    from public.orders o where o.idempotency_key = p_idempotency_key;
    if found then
      return query select v_order_id, v_created_at;
      return;
    end if;
  end if;

  begin
    insert into public.orders (
      client_id, manager_id, services, amount, discount_percent, discount_amount, comment, idempotency_key
    )
    values (
      p_client_id, v_uid, p_services, p_amount,
      coalesce(p_discount_percent, 0), coalesce(p_discount_amount, 0), p_comment, p_idempotency_key
    )
    returning orders.id, orders.created_at into v_order_id, v_created_at;
  exception when unique_violation then
    -- Concurrent same-key insert won the race → return its order (items/recalc already done by it).
    select o.id, o.created_at into v_order_id, v_created_at
    from public.orders o where o.idempotency_key = p_idempotency_key;
    return query select v_order_id, v_created_at;
    return;
  end;

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
      it -> 'addons'
    from jsonb_array_elements(p_items) as it;
  end if;

  update public.clients
    set assigned_manager_id = v_uid
    where id = p_client_id and assigned_manager_id is null;

  perform public.recalc_client_aggregates(array[p_client_id]);

  return query select v_order_id, v_created_at;
end;
$$;

-- ACL: only authenticated (the old 7-arg overload is replaced; assert the new 8-arg grant).
revoke execute on function public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb, text)
  from public, anon;
grant execute on function public.create_order_with_items(uuid, text[], integer, numeric, integer, text, jsonb, text)
  to authenticated;

commit;
