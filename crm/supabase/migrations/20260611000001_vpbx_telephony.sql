-- Migration: VPBX (Beeline CloudPBX) telephony integration
-- Adds telephony call records + webhook event dedup log.
-- Source of truth for calls = vpbx_calls (filled by VPBX-Events webhook + MakeCall2).
-- call_logs remains the manager disposition log, linked via external_call_id.
-- Created: 2026-06-11

-- ============================================================
-- 1. vpbx_calls — telephony calls (inbound + outbound)
-- ============================================================
create table if not exists public.vpbx_calls (
  id                   uuid primary key default gen_random_uuid(),
  vpbx_uuid            text unique,                 -- call uuid from VPBX (MakeCall2 / events)
  external_call_id     text,                        -- our correlation id (crm-<uuid>)
  direction            text not null default 'outbound'
                         check (direction in ('outbound', 'inbound', 'internal')),
  number_a             text,                        -- A-side (caller)
  number_b             text,                        -- B-side (callee)
  line_number          text,                        -- МКН (city number) for inbound
  client_id            uuid references public.clients(id) on delete set null,
  manager_id           uuid references public.profiles(id) on delete set null,
  finish_status        text
                         check (finish_status in ('ANSWERED', 'NOT_ANSWERED', 'BUSY', 'CANCELLED')),
  duration             integer not null default 0 check (duration >= 0),
  is_recorded          boolean not null default false,
  record_url           text,                        -- recordUrl (with JWT) from CallFinishEvent
  transcription_status text not null default 'none'
                         check (transcription_status in ('none', 'pending', 'done', 'failed')),
  transcript           text,                        -- Whisper transcript of the VPBX recording
  summary              text,                        -- AI call summary
  score                integer check (score is null or (score between 1 and 10)),
  started_at           timestamptz,
  answered_at          timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_vpbx_calls_external on public.vpbx_calls (external_call_id);
create index if not exists idx_vpbx_calls_client on public.vpbx_calls (client_id);
create index if not exists idx_vpbx_calls_manager on public.vpbx_calls (manager_id);
create index if not exists idx_vpbx_calls_created on public.vpbx_calls (created_at desc);
create index if not exists idx_vpbx_calls_pending_tr
  on public.vpbx_calls (transcription_status)
  where transcription_status = 'pending';

-- ============================================================
-- 2. vpbx_events — webhook dedup log (append-only)
-- ============================================================
create table if not exists public.vpbx_events (
  event_id    text primary key,                   -- eventID from VPBX (UUID v4) — dedup key
  vpbx_uuid   text,
  type        text not null,                      -- CallStartEvent / CallStateEvent / CallFinishEvent
  payload     jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_vpbx_events_uuid on public.vpbx_events (vpbx_uuid);
create index if not exists idx_vpbx_events_received on public.vpbx_events (received_at);

-- ============================================================
-- 3. Link disposition log to telephony call
-- ============================================================
alter table public.call_logs add column if not exists external_call_id text;
create index if not exists idx_call_logs_external on public.call_logs (external_call_id);

-- ============================================================
-- 4. RLS — reads for admin (all) and managers (own).
--    Writes happen via service role only (webhook/cron/server actions use admin client),
--    which bypasses RLS, so no write policies are defined (default deny).
-- ============================================================
alter table public.vpbx_calls enable row level security;
alter table public.vpbx_events enable row level security;

create policy "admin can select all vpbx_calls"
  on public.vpbx_calls for select
  to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "manager can select own vpbx_calls"
  on public.vpbx_calls for select
  to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    and manager_id = auth.uid()
  );

-- vpbx_events: no authenticated policy => only service role can read/write.
