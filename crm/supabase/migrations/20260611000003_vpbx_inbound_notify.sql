-- Migration: VPBX inbound call notifications
-- Enables Realtime on vpbx_calls and lets managers see unassigned inbound calls
-- so the browser can show an "incoming call" toast.
-- Created: 2026-06-11

-- ============================================================
-- 1. Realtime publication for vpbx_calls (idempotent)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vpbx_calls'
  ) then
    alter publication supabase_realtime add table public.vpbx_calls;
  end if;
end $$;

-- ============================================================
-- 2. RLS: managers see unassigned inbound calls (manager_id IS NULL).
--    Additive to existing policies (own calls + admin all).
--    Business rule: inbound from a client without an assigned manager
--    is shown to ALL managers (decision 2026-06-11).
-- ============================================================
drop policy if exists "manager can select unassigned inbound vpbx_calls" on public.vpbx_calls;
create policy "manager can select unassigned inbound vpbx_calls"
  on public.vpbx_calls for select
  to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    and direction = 'inbound'
    and manager_id is null
  );
