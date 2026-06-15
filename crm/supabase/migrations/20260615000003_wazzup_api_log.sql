-- Wazzup integration — Migration: API action log (monitoring)
-- Append-only audit of outbound Wazzup API actions (message send, iframe open).
-- Wazzup billing is subscription-based, NOT per-transaction → no `billed` column.
-- RLS: deny-by-default (no authenticated policies) — read only via service role.
-- Created: 2026-06-15
-- See: app/(protected)/settings/integrations/wazzup, lib/wazzup/log.ts

create table public.wazzup_api_log (
  id            uuid primary key default gen_random_uuid(),
  command       text not null,          -- 'message.send' | 'iframe.open'
  op            text,                    -- 'send' | 'open'
  direction     text not null default 'outbound'
                  check (direction in ('outbound','inbound')),
  crm_entity    text,                    -- 'client' | 'broadcast'
  crm_entity_id uuid,
  manager_id    uuid,                    -- кто инициировал (soft ref, без FK — append-only лог)
  channel_id    text,
  chat_id       text,
  message_id    text,
  http_status   integer,
  error_code    text,
  latency_ms    integer,
  request       jsonb,                   -- без секретов (без apiKey/Authorization)
  response      jsonb,                   -- без секретов
  created_at    timestamptz not null default now()
);
create index idx_wazzup_api_log_created on public.wazzup_api_log (created_at);
create index idx_wazzup_api_log_entity on public.wazzup_api_log (crm_entity, crm_entity_id);
alter table public.wazzup_api_log enable row level security;
-- НЕТ политик для authenticated → доступ только service_role (байпасит RLS). deny-by-default.

-- ============================================================
-- DOWN (reverse) — применять при откате:
--   drop table if exists public.wazzup_api_log;
-- ============================================================
