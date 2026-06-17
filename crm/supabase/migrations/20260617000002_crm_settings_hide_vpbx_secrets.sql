-- Migration: hide VPBX secrets in crm_settings from non-admin direct reads
--
-- PROBLEM (secret exposure): crm_settings SELECT policy is `using (true)`, so ANY
-- authenticated manager can run `supabase.from('crm_settings').select('*')` straight
-- from the browser and read `vpbx_token` and `vpbx_webhook_secret`. The app-layer guard
-- in getSettings() (settings/actions.ts:74-77 returns '' for non-admins) does NOT protect
-- a direct client query — only RLS does. With the webhook secret an attacker can forge
-- Beeline VPBX webhook events (webhook auth is `?s=<secret>`); with the token they can
-- drive the telephony API. The team already documented this class of issue
-- (lib/agbis/config.ts: "crm_settings has SELECT USING(true)") and kept Agbis secrets in
-- env for that reason — VPBX secrets were left behind in crm_settings.
--
-- FIX: scope the SELECT policy so the two secret keys are readable only by admins.
-- All non-secret keys (discounts, scripts, segment_rules, sales_plan, day_target,
-- vpbx_url, vpbx_profile_id, vpbx_can_call) stay readable by managers exactly as before,
-- so the manager UI is unaffected. Server-side reads use the service-role/admin client
-- (lib/vpbx/client.ts) which bypasses RLS, so telephony keeps working.
--
-- Reversible: re-create the policy with `using (true)`.
-- Created: 2026-06-17

drop policy if exists "authenticated can read settings" on public.crm_settings;

create policy "authenticated can read settings" on public.crm_settings
  as permissive for select to authenticated
  using (
    key not in ('vpbx_token', 'vpbx_webhook_secret')
    or (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
  );
