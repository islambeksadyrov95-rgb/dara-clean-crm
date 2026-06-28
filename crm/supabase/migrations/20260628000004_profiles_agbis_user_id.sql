-- Remove the hardcoded CRM-email → Agbis-user-id map (lib/agbis/managers.ts) — move it to the DB so
-- a new manager is configured by a single UPDATE, not a code deploy. The hardcode only knew elena/
-- samal, so admin@dara.clean (the owner, who DOES create orders) and any new manager silently fell
-- to the API user (Дарын=1022) → wrong "Приёмщик" in Agbis. CRM manager_id was always correct; this
-- fixes only the Agbis-side attribution.
--
-- Agbis user ids verified: elena=1035, samal=1023 (live orders 2026-06-16); admin/Исламбек=1057
-- (live Firebird cancel record, CANCEL-FEATURE-RND.md). manager1/manager2 are new (created 06-27, no
-- orders yet, likely no Agbis приёмщик account) → left NULL = API user (the safe current behavior).
--
-- DOWN: alter table profiles drop column agbis_user_id. (managers.ts reverts to the hardcoded map.)
-- D-2026-06-28-agbis-user-map. Created: 2026-06-28

begin;

alter table public.profiles add column if not exists agbis_user_id text;

update public.profiles set agbis_user_id = '1035' where lower(email) = 'elena@daraclean.kz';
update public.profiles set agbis_user_id = '1023' where lower(email) = 'samal@daraclean.kz';
update public.profiles set agbis_user_id = '1057' where lower(email) = 'admin@dara.clean';

commit;
