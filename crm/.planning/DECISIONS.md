# DECISIONS — Dara Clean CRM

> Append-only decision log. Immutable — never edit, only append.
> Referenced from REGISTRY.md entries. `[arch]` = architecture decision.

## D-2026-06-11-role-in-app-metadata
Authorization role moved from `user_metadata.role` to `app_metadata.role`. user_metadata is
self-writable by any authenticated user (`auth.updateUser({data:{role:'admin'}})`), which let a
manager self-promote to admin — bypassing both RLS (read user_metadata) and in-code checks. Fix:
role now lives in raw_app_meta_data (writable only by service role / Admin API). handle_new_user
trigger, all RLS policies, and `getUserRole` read from app_metadata. Deploy required coordinated
migration + code + global re-login (old JWTs lacked the claim).
Migration: 20260611000004_role_to_app_metadata.sql. Code: lib/auth/get-user-role.ts, team/actions.ts.
Rejected: keeping role in profiles only — RLS would need a per-row subquery (slow, and profiles.role
was itself sourced from the spoofable user_metadata).

## D-2026-06-12-money-as-whole-tenge
All monetary columns are `integer` whole tenge — NOT smallest-unit tiyn. Business deals in whole
tenge; sub-tenge precision is meaningless for this domain and tiyn conversion was explicitly out of
scope (EXECUTION-PLAN «Вне скоупа»). Pre-migration fractional values (10 clients + 1 order) were
round()'d; snapshot taken before migration. discount_percent stays numeric(5,2) (a percentage, not
money). Always Math.round() after money math.
Migration: 20260612000001_money_to_integer.sql.
Rejected: tiyn (×100 integer smallest-unit) — adds conversion complexity for zero business benefit.

## D-2026-06-11-deploy-cli-only [arch]
No git-based deploy integration. Production deploys happen only via CLI: `npx vercel deploy --prod`.
Database migrations are applied separately (`npm run db:migrate`, Supabase Management API) before/with
the deploy. There is no auto-deploy on push; "done" = manually deployed + verified.

## D-2026-06-11-call-recordings-private-bucket
The `call-recordings` Supabase Storage bucket is **private**, not public. Recordings are served via
short-lived (1 hour) signed URLs generated on demand (`queue/actions.ts:getClientCallHistory`).
Old recordings work too — the storage path is extracted from the previously-stored public URL.
Rejected: public bucket — call recordings are sensitive PII; permanent public URLs leak them.

## D-2026-06-11-microsip-local-recording-sync [arch]
MicroSIP saves call recordings as local MP3 files (Record call/ folder). These are synced to the
`call-recordings` bucket from the **browser** using the File System Access API (no server-side file
access). The sync daemon runs in the protected layout (recording-sync-daemon).
Rejected: in-browser audio mixing/recording — declined in favor of MicroSIP's native MP3 capture.
