-- Agbis integration — Migration: outbox dedup + reliable claim/settle state machine (P1 idempotency)
-- Fixes the double-order bug: a SaveOrderForAll that COMMITS at Agbis but TIMES OUT (10s abort) was
-- caught → marked pending → re-queued; the nightly drain re-ran the push with the same empty guard
-- and created a SECOND real Agbis order. This migration adds:
--   1. a partial UNIQUE index so one order is enqueued at most once (entity='order');
--   2. claim_agbis_outbox  — atomic FOR UPDATE SKIP LOCKED claim (the JS client cannot row-lock);
--   3. settle_agbis_outbox — success → 'done' / failure → exponential backoff or 'dead'.
-- The read-back idempotency guard itself lives in app code (lib/agbis/push-order.ts) — Agbis has no
-- server-enforced external id, so we re-read the day window by contr_id before re-pushing.
-- service definer + revoke from public/anon/authenticated → only the service role (cron) calls these.
-- Money: untouched (no money columns here). Created: 2026-06-17.
-- See: docs/integrations/agbis-api/PLAN.md (v2 B8), .planning/AUDIT-2026-06-17.md (P1 #2)
--
-- DOWN migration (manual rollback):
--   begin;
--   drop function if exists public.settle_agbis_outbox(uuid, boolean, text, integer);
--   drop function if exists public.claim_agbis_outbox(text, integer, text);
--   drop index if exists public.uq_agbis_outbox_entity_crm_op;
--   commit;

begin;

-- ============================================================
-- 1. Dedup: one order is queued at most once. Trips legitimately have TWO rows per order
--    (one per arm, distinguished by payload->>kind), so the constraint is scoped to orders only.
-- ============================================================
-- Defensively collapse any pre-existing duplicate order rows before the unique index is built
-- (keep the earliest row per (crm_id,op); the others would have driven a duplicate push).
delete from public.agbis_outbox a
using public.agbis_outbox b
where a.entity = 'order' and b.entity = 'order'
  and a.crm_id = b.crm_id and a.op = b.op
  and a.ctid > b.ctid;

create unique index uq_agbis_outbox_entity_crm_op
  on public.agbis_outbox (entity, crm_id, op)
  where entity = 'order';

-- ============================================================
-- 2. claim_agbis_outbox — atomically claim up to p_limit due rows of one entity.
--    Picks rows that are pending/error, unclaimed, and due (next_attempt_at <= now), locking
--    them with FOR UPDATE SKIP LOCKED so concurrent drains never grab the same row. Marks each
--    claimed row in_progress, stamps claimed_at/claimed_by, and increments attempts (so a row
--    that crashes mid-flight still counts as an attempt and won't loop forever).
-- ============================================================
create or replace function public.claim_agbis_outbox(
  p_entity     text,
  p_limit      integer default 50,
  p_claimed_by text default 'cron'
)
returns table (
  id           uuid,
  crm_id       uuid,
  payload      jsonb,
  attempts     integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select o.id
    from public.agbis_outbox o
    where o.entity = p_entity
      and o.op = 'create'
      and o.state in ('pending', 'error')
      and o.claimed_at is null
      and o.next_attempt_at <= now()
    order by o.next_attempt_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.agbis_outbox o
  set state      = 'in_progress',
      claimed_at = now(),
      claimed_by = p_claimed_by,
      attempts   = o.attempts + 1,
      updated_at = now()
  from due
  where o.id = due.id
  returning o.id, o.crm_id, o.payload, o.attempts, o.max_attempts;
end;
$$;

revoke execute on function public.claim_agbis_outbox(text, integer, text) from public, anon, authenticated;

-- ============================================================
-- 3. settle_agbis_outbox — finish a claimed row.
--    success           → state='done' (terminal; kept for audit, cleaned by retention).
--    failure, can retry → state='error', released (claimed_at=null), next_attempt_at backed off.
--    failure, exhausted → state='dead' (operator review; never silently retried again).
--    p_backoff_seconds is computed by the caller (exponential + jitter) so the schedule is testable.
-- ============================================================
create or replace function public.settle_agbis_outbox(
  p_id              uuid,
  p_success         boolean,
  p_error           text default null,
  p_backoff_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts     integer;
  v_max_attempts integer;
begin
  if p_success then
    update public.agbis_outbox
    set state      = 'done',
        claimed_at = null,
        claimed_by = null,
        last_error = null,
        updated_at = now()
    where id = p_id;
    return;
  end if;

  select attempts, max_attempts into v_attempts, v_max_attempts
  from public.agbis_outbox where id = p_id;
  if not found then
    return;
  end if;

  if v_attempts >= v_max_attempts then
    -- Exhausted: park as dead-letter for an operator. Never auto-retried again.
    update public.agbis_outbox
    set state      = 'dead',
        claimed_at = null,
        claimed_by = null,
        last_error = p_error,
        updated_at = now()
    where id = p_id;
  else
    -- Retry later: release the claim and back off.
    update public.agbis_outbox
    set state           = 'error',
        claimed_at      = null,
        claimed_by      = null,
        last_error      = p_error,
        next_attempt_at = now() + make_interval(secs => greatest(p_backoff_seconds, 1)),
        updated_at      = now()
    where id = p_id;
  end if;
end;
$$;

revoke execute on function public.settle_agbis_outbox(uuid, boolean, text, integer) from public, anon, authenticated;

commit;
