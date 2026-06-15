-- Agbis integration — Migration: infra tables (Phase 1)
-- New, self-contained tables only. Does NOT touch clients/orders (separate migration).
-- RLS: deny-by-default (no authenticated policies) except read-only catalog.
-- Created: 2026-06-15
-- See: docs/integrations/agbis-api/PLAN.md (v2), DECISIONS.md

-- ============================================================
-- 1. agbis_session — единственная строка сессии (deny-by-default)
--    Хранит Session_id/Refresh_id. НЕ в crm_settings (там SELECT USING(true)).
-- ============================================================
create table public.agbis_session (
  id          smallint primary key default 1 check (id = 1), -- singleton
  session_id  text,
  refresh_id  text,
  user_id     text,
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.agbis_session enable row level security;
-- НЕТ политик для authenticated → доступ только service_role (байпасит RLS). deny-by-default.

-- ============================================================
-- 2. agbis_sync_state — курсоры инкремента по сущностям (deny-by-default)
-- ============================================================
create table public.agbis_sync_state (
  entity          text primary key check (entity in ('catalog','clients','orders')),
  last_synced_at  timestamptz,           -- курсор по timestamp Агбиса (не local now())
  last_run_at     timestamptz,
  last_status     text,
  last_error      text,
  backfilled      boolean not null default false, -- one-time бэкфилл линковки выполнен
  updated_at      timestamptz not null default now()
);
alter table public.agbis_sync_state enable row level security;

-- ============================================================
-- 3. agbis_outbox — очередь надёжности для CRM→Agbis записей (deny-by-default)
--    Per-row claim через FOR UPDATE SKIP LOCKED (см. PLAN v2 B8).
-- ============================================================
create table public.agbis_outbox (
  id              uuid primary key default gen_random_uuid(),
  entity          text not null check (entity in ('client','order','status','pay')),
  crm_id          uuid not null,                 -- clients.id / orders.id
  op              text not null check (op in ('create','update','status','pay')),
  payload         jsonb not null default '{}'::jsonb,
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,                   -- per-row claim
  claimed_by      text,
  last_error      text,
  state           text not null default 'pending'
                    check (state in ('pending','in_progress','done','error','dead','pending_manual')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_agbis_outbox_claim
  on public.agbis_outbox (next_attempt_at)
  where state in ('pending','error') and claimed_at is null;
create index idx_agbis_outbox_crm on public.agbis_outbox (entity, crm_id);
alter table public.agbis_outbox enable row level security;

-- ============================================================
-- 4. agbis_api_log — append-only аудит каждой записи/попытки (deny-by-default)
--    Источник биллинг-сверки. Тела Login/RefreshSession НЕ логировать (пароль).
-- ============================================================
create table public.agbis_api_log (
  id                uuid primary key default gen_random_uuid(),
  command           text not null,
  op                text,
  crm_entity        text,
  crm_entity_id     uuid,
  http_status       integer,
  error_code        integer,
  agbis_dor_id      text,
  agbis_contr_id    text,
  billed            boolean not null default false,
  executed_api_count integer,
  latency_ms        integer,
  request           jsonb,            -- без секретов
  response          jsonb,            -- без секретов
  created_at        timestamptz not null default now()
);
create index idx_agbis_api_log_created on public.agbis_api_log (created_at);
create index idx_agbis_api_log_entity on public.agbis_api_log (crm_entity, crm_entity_id);
alter table public.agbis_api_log enable row level security;

-- ============================================================
-- 5. agbis_price_items — кэш каталога Агбиса (READ-ONLY для authenticated)
--    Форма заказа читает каталог. Запись — только service role.
-- ============================================================
create table public.agbis_price_items (
  id                  uuid primary key default gen_random_uuid(),
  agbis_tovar_id      text not null unique,
  code                text,
  name                text not null,
  unit                text,
  price               integer not null default 0 check (price >= 0), -- тенге, Math.round при парсе
  tovar_type          smallint check (tovar_type in (1,2)),          -- 1 товар, 2 услуга
  folder_id           text,
  group_name          text,
  top_parent          text,
  order_addon_pack_id text,
  is_price_editable   boolean not null default false,
  is_active           boolean not null default true,
  price_id            text not null default '0',
  synced_at           timestamptz not null default now()
);
create index idx_agbis_price_items_tovar on public.agbis_price_items (agbis_tovar_id);
create index idx_agbis_price_items_type on public.agbis_price_items (tovar_type) where is_active;
alter table public.agbis_price_items enable row level security;
create policy "authenticated can read agbis catalog"
  on public.agbis_price_items for select to authenticated using (true);
-- write — только service role (без INSERT/UPDATE/DELETE политик).

-- ============================================================
-- DOWN (reverse) — применять при откате:
--   drop table if exists public.agbis_price_items;
--   drop table if exists public.agbis_api_log;
--   drop table if exists public.agbis_outbox;
--   drop table if exists public.agbis_sync_state;
--   drop table if exists public.agbis_session;
-- ============================================================
