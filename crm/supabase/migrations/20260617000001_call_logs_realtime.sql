-- Add call_logs to the Supabase realtime publication so the sidebar "перезвоны"
-- badge updates live (push) on disposition changes instead of refetching on every
-- navigation (pull). Additive + idempotent: only adds the table if not already a
-- member. RLS still gates which rows each manager receives (own call_logs), exactly
-- like vpbx_calls (see 20260611000003_vpbx_inbound_notify.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_logs'
  ) then
    alter publication supabase_realtime add table public.call_logs;
  end if;
end $$;
