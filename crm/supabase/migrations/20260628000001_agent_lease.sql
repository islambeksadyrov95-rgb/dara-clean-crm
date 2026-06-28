-- Agent lease (leader election) — make the trip-binding/cancel agent SAFE to run on N PCs.
-- Only the lease holder writes the Firebird junction; the others stand by and fail over (~TTL)
-- when the holder dies. Fixes the concrete junction-id PK / duplicate-binding collision risk of two
-- concurrent agents (DEP-3 band, hand-rolled id, LOCAL-only id_taken check gives zero protection
-- against a second writer). deny-by-default; only the service role (the agent's key) reaches the
-- table, via the SECURITY DEFINER RPC below. Created: 2026-06-28.
--
-- DOWN (manual rollback):
--   begin;
--   drop function if exists public.acquire_agent_lease(text, integer);
--   drop table if exists public.agent_lease;
--   commit;

begin;

create table if not exists public.agent_lease (
  id          smallint primary key default 1 check (id = 1), -- singleton: one lease for the whole binding agent
  holder      text,                                          -- "<hostname>:<pid>" of the active agent
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);
insert into public.agent_lease (id) values (1) on conflict (id) do nothing;

alter table public.agent_lease enable row level security;
-- No authenticated policies → deny-by-default. Only service_role (the agent) + the RPC touch it.

-- Atomic acquire/renew: take the lease IFF it is free (null/expired) or already ours. A single UPDATE
-- under the row lock serializes concurrent agents, so two can NEVER both win. Returns true if we hold it.
create or replace function public.acquire_agent_lease(p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_got boolean;
begin
  update public.agent_lease
     set holder     = p_holder,
         expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 5)),
         updated_at = now()
   where id = 1
     and (expires_at is null or expires_at < now() or holder = p_holder)
  returning true into v_got;
  return coalesce(v_got, false);
end;
$$;

revoke execute on function public.acquire_agent_lease(text, integer) from public, anon, authenticated;

commit;
