-- Migration: move authorization role from user_metadata to app_metadata
--
-- PROBLEM (privilege escalation): the role lives in raw_user_meta_data, which any
-- authenticated user can rewrite themselves via supabase.auth.updateUser({data:{role:'admin'}}).
-- The handle_new_user trigger then copies that into profiles.role, so a manager could
-- self-promote to admin — bypassing BOTH the RLS policies (auth.jwt()->'user_metadata'->>'role')
-- AND the in-code checks (user.user_metadata?.role).
--
-- FIX: authority moves to raw_app_meta_data, which is writable ONLY by the service role
-- (Admin API) — never by the end user. The trigger, all RLS policies, and the app code
-- read role from app_metadata instead.
--
-- WARNING — DEPLOY AS A COORDINATED UNIT — DO NOT APPLY THIS MIGRATION ALONE:
--   1. Apply this migration (backfills app_metadata, switches trigger + policies).
--   2. Deploy the matching code change (user_metadata.role -> app_metadata.role; team
--      member creation must set app_metadata.role via the Admin API).
--   3. Force a global sign-out / re-login. Existing JWTs were minted WITHOUT the
--      app_metadata.role claim; until each session refreshes, the new policies see no
--      role and that user loses access. Do this off-hours.
-- Reversible: re-run the previous migrations' policy definitions (user_metadata) + restore
-- the old trigger. Keep a DOWN script ready before applying.
-- Created: 2026-06-11

-- ============================================================
-- 1. Backfill app_metadata.role from the current user_metadata.role
-- ============================================================
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', coalesce(raw_user_meta_data ->> 'role', 'manager'));

-- Resync profiles.role from the now-authoritative app_metadata.
update public.profiles p
set role = coalesce(u.raw_app_meta_data ->> 'role', 'manager'),
    updated_at = now()
from auth.users u
where u.id = p.id;

-- ============================================================
-- 2. Trigger reads role from app_metadata (name stays in user_metadata — not a privilege)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_app_meta_data ->> 'role', 'manager')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 3. Switch every role-based RLS policy from user_metadata to app_metadata
--    (generated from the live policy set — 10 policies across 6 tables)
-- ============================================================

drop policy if exists "authenticated can delete templates" on public.broadcast_templates;
create policy "authenticated can delete templates" on public.broadcast_templates
  as permissive for delete to authenticated
  using (((auth.uid() = created_by) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

drop policy if exists "admin can select all call_logs" on public.call_logs;
create policy "admin can select all call_logs" on public.call_logs
  as permissive for select to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "manager can select own call_logs" on public.call_logs;
create policy "manager can select own call_logs" on public.call_logs
  as permissive for select to authenticated
  using (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text) AND (manager_id = auth.uid())));

drop policy if exists "admin can update settings" on public.crm_settings;
create policy "admin can update settings" on public.crm_settings
  as permissive for all to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "admin can select all orders" on public.orders;
create policy "admin can select all orders" on public.orders
  as permissive for select to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "manager can select own orders" on public.orders;
create policy "manager can select own orders" on public.orders
  as permissive for select to authenticated
  using (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text) AND (manager_id = auth.uid())));

drop policy if exists "admin can manage sales_plans" on public.sales_plans;
create policy "admin can manage sales_plans" on public.sales_plans
  as permissive for all to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "admin can select all vpbx_calls" on public.vpbx_calls;
create policy "admin can select all vpbx_calls" on public.vpbx_calls
  as permissive for select to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "manager can select own vpbx_calls" on public.vpbx_calls;
create policy "manager can select own vpbx_calls" on public.vpbx_calls
  as permissive for select to authenticated
  using (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text) AND (manager_id = auth.uid())));

drop policy if exists "manager can select unassigned inbound vpbx_calls" on public.vpbx_calls;
create policy "manager can select unassigned inbound vpbx_calls" on public.vpbx_calls
  as permissive for select to authenticated
  using (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text) AND (direction = 'inbound'::text) AND (manager_id IS NULL)));

-- NOTE: the clients table policies use a profiles-subquery for the admin check
-- (profiles.role = 'admin'), not user_metadata. Since profiles.role is now sourced
-- only from app_metadata (steps 1-2), those policies become safe automatically.
