-- Migration: client next-action + sticky note columns on public.clients
-- next_action_at / next_action_note — «следующий шаг» по клиенту: snooze очереди
-- обзвона + план на карточке клиента.
-- sticky_note — заметка-стикер о клиенте (свободный текст, постоянно видна в карточке).
-- One migration for both features (decision T2.6: один файл вместо двух на ту же таблицу).
-- RLS unchanged: columns added to an existing table, policies already cover clients.
-- client_segments view selects explicit columns from clients (not select *),
-- so adding columns does NOT break it — no view recreate needed.
-- Created: 2026-06-12
--
-- DOWN (manual rollback):
--   drop index if exists public.idx_clients_next_action;
--   alter table public.clients
--     drop column if exists sticky_note,
--     drop column if exists next_action_note,
--     drop column if exists next_action_at;

alter table public.clients
  add column if not exists next_action_at   timestamptz,
  add column if not exists next_action_note text,
  add column if not exists sticky_note      text;

create index if not exists idx_clients_next_action
  on public.clients (next_action_at) where next_action_at is not null;
