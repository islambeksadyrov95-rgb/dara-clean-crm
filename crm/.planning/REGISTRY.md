# REGISTRY — Dara Clean CRM

> Knowledge index for the repeat-sales CRM (Next.js 16 + Supabase).
> POINTERS to code, not copies. Read the relevant entity card BEFORE editing.
> Source of truth for schema: `types/database.ts` (regen via `npm run gen:types`).
> Last reviewed: 2026-06-12 (Foundation F3).

---

## Entities

Core business tables + 1 view, RLS on every table (default deny). Plus order_history, order_items, and Agbis integration tables (agbis_*, Phase 1). Also: tags/client_tags/acquisition_sources/saved_filters — see §Infrastructure (FilterBar).

### Client | clients | lib/segments.ts
- Table: id(uuid PK), name, phone(E.164 unique), address, assigned_manager_id(uuid→profiles, nullable), total_orders(int), total_spent(int tenge), avg_order_value(int tenge), last_order_date(date), last_called_at(timestamptz), locked_by(uuid, nullable), locked_until(timestamptz, nullable), segment_override(text, nullable = auto), agbis_client_id(text, unique-when-set, nullable), agbis_synced_at(timestamptz), sync_status(text default local; local|synced|pending|error), sync_error(text), created_at, updated_at
- agbis_* sync columns added `20260615000002` (Phase 1). Match by phone → set agbis_client_id; written by Agbis sync (service role). Conflict rule: CRM source-of-truth — for linked clients CRM does NOT accept incoming name/phone/address (D-2026-06-15-crm-source-of-truth).
- Aggregates (total_orders/total_spent/avg_order_value/last_order_date) are maintained in **app code**, not DB triggers: createOrder (`app/(protected)/queue/order/actions.ts:82`) and deleteOrder recompute (`app/(protected)/orders/actions.ts:56`). Bulk/atomic recompute via RPC `recalc_client_aggregates(uuid[])` (`20260612000003`, security definer, service-role only) — sums **order_history ∪ orders**. ⚠ NO cross-table dedup: sync must never write the same order to both tables (review HIGH 2026-06-15; enforce in Phase 4).
- segment_override: manual RFM override; NULL = computed live by `compute_segment`.
- locked_by/locked_until: queue lock (10 min) — see Rules §Queue Lock.
- next_action_at/next_action_note: «следующий шаг» — queue snooze (`queue/actions.ts:snoozeClient`, 30m/2h/завтра 09:00 Almaty) + card editing (`clients/actions.ts:updateClientNextAction`). Queue hides future next_action_at, due ones float to top. NOT in client_segments view — queue fetches via extra query.
- sticky_note: заметка-стикер — шапка панели звонка + карточка (`clients/actions.ts:updateClientStickyNote`). Пишется user-клиентом: RLS UPDATE = own/unassigned/admin (verified live 2026-06-12).
- API/actions: import (`import/actions.ts:importClients`), lock/unlock (`queue/actions.ts:39,61`), assign (`team/actions.ts:autoAssignUnassignedClients`, assign-button), clients page actions (`clients/actions.ts`)
- Pages: /clients, /clients/[id], /queue (reads via client_segments), /broadcasts
- FK in: orders.client_id, call_logs.client_id, vpbx_calls.client_id, broadcast_logs.client_id
- Indexes: btree phone/last_order_date/locked_by/last_called_at/assigned_manager/next_action; GIN pg_trgm name+phone для ilike-поиска (`20260612000005_search_trgm_indexes.sql`)
- Roles/RLS (verified live 2026-06-12, pg_policies): SELECT = own (assigned_manager_id = auth.uid()) or admin; INSERT with_check = own or admin; UPDATE = own/unassigned or admin (with_check own/admin); DELETE = admin. Server actions mostly use admin client (bypass) — карточка видит всю базу осознанно.

### ClientSegments (VIEW) | client_segments | migration 20260611000005 / 20260612000001
- View over clients with `security_invoker = true` (RLS of caller respected).
- Adds: rfm_segment = coalesce(segment_override, compute_segment(total_orders, last_order_date)); days_since_last_order = current_date − last_order_date.
- Filter: excludes clients whose **latest** call_log status is `declined` or `not_relevant` (i.e. dead leads hidden from queue). Definition: `20260612000001_money_to_integer.sql:49`.
- Used by: /queue (the calling queue source), /clients, broadcasts.

### Order | orders | app/(protected)/queue/order/actions.ts
- Table: id(uuid PK), client_id(uuid→clients), manager_id(uuid), services(text[]), amount(int tenge), discount_percent(numeric(5,2)), discount_amount(int tenge), comment, created_at, **+ Agbis mirror (`20260615000002`):** agbis_order_id(text unique-when-set), agbis_doc_num, agbis_sclad_id, agbis_sclad_out_id, agbis_price_id, agbis_status_id(smallint), agbis_status_name(text — READ-ONLY mirror of Agbis status), agbis_synced_at, sync_status(text default local), sync_error
- No status field locally — orders are a single financial record (no lifecycle state machine). agbis_status_* is a read-only mirror; we take statuses FROM Agbis, never invent. Mirror columns written only by sync (service role) — orders has no UPDATE RLS for authenticated.
- Line items: `order_items` (1:N, ON DELETE CASCADE) — structured positions; `services[]` kept for back-compat (names). Source of positions = order_items.
- Atomic create RPC: `create_order_with_items(p_client_id, p_services, p_amount, p_discount_percent, p_discount_amount, p_comment, p_items jsonb)` (`20260615000002`, security definer, grant authenticated) — ONE transaction: orders + order_items + idempotent `recalc_client_aggregates` (NOT +=); pins manager_id=auth.uid() (anti-IDOR); does NOT compute discounts (caller passes them). **NOT yet wired** — createOrder still uses the legacy non-atomic JS path (`+=`, raw error, `any`); RPC is wired + p_items Zod-validated in Phase 4 with the form rebuild.
- Side effects on create: bump client aggregates, set last_order_date, auto-assign manager if unassigned (`order/actions.ts:82-109`).
- Side effects on delete (admin only): recompute client aggregates (`orders/actions.ts`).
- API/actions: createOrder (`queue/order/actions.ts:30`), deleteOrder (`orders/actions.ts:8`, admin-gated)
- Pages: /orders, /queue/order (order form within call flow)
- Roles: manager+admin insert; manager select own, admin select all; **delete admin-only** (no DELETE RLS policy → done via admin client, `orders/actions.ts:26`)
- RLS: `20260514000001_schema.sql:102` + app_metadata switch `20260611000004:88`
- Rules: Discount (§Discount Calculation). D1: for Agbis orders Agbis is authoritative for price/discount (D-2026-06-15-pricing-agbis-authoritative) — legacy `calculateDiscount` retired for them.

### OrderItem | order_items | (created via create_order_with_items RPC)
- Table: id(uuid PK), order_id(uuid→orders ON DELETE CASCADE), agbis_tovar_id(text→agbis_price_items), name(not null), qty(int>0 default 1), kfx(numeric — Agbis coefficient, nullable), unit_price(int tenge), line_amount(int tenge — Agbis-authoritative D1), discount_percent(numeric(5,2)), addons(jsonb), created_at
- Structured line items for CRM-created orders (Agbis-priced). NEW `20260615000002`.
- Index: idx_order_items_order (order_id). FK in: none.
- RLS: SELECT via parent join (manager owns parent order OR admin app_metadata). NO authenticated INSERT/UPDATE/DELETE — deny-by-default; sole write paths = `create_order_with_items` (security definer) + service role (sync).

### OrderHistory | order_history | app/(protected)/import/actions.ts (service role)
- Table: id(uuid PK), client_id(uuid→clients ON DELETE CASCADE), order_date(date), amount(int tenge ≥0), service(text), address(text), source(text default agbis_import; agbis_import|manual), import_batch_id(uuid — rollback a specific import), created_at
- Imported/historical orders, SEPARATE from live `orders` (no manager, real order date, excluded from live KPI/state). Owner of client order *history*. Created `20260612000002` (was missing from REGISTRY).
- Aggregates: counted by `recalc_client_aggregates` together with live orders (see Client). Index: client_id, (client_id,order_date desc), import_batch_id.
- RLS: SELECT manager sees own clients' history / admin all; INSERT/UPDATE/DELETE admin-only (imports run via service role).
- DECISION: Agbis-imported & historical orders go HERE, not into `orders` (D-2026-06-15-arch-history-target).

### Agbis integration tables | agbis_* | lib/agbis/ (planned), docs/integrations/agbis-api/
- All created `20260615000001_agbis_infra` (Phase 1). Sync engine `lib/agbis/` = next step (not built yet). See docs/integrations/agbis-api/PLAN.md (v2) + DECISIONS.md.
- `agbis_price_items` — catalog cache (PriceList mirror): agbis_tovar_id(unique), name, price(int tenge), tovar_type(1 товар/2 услуга), price_id, is_active… RLS: read authenticated, write service-role.
- `agbis_session` — singleton session row (session_id/refresh_id/expires_at). Deny-by-default RLS (service-role only; NOT in crm_settings — that has SELECT USING(true)). D-2026-06-15-arch-session-storage.
- `agbis_sync_state` — per-entity cursors (catalog/clients/orders): last_synced_at, backfilled. Deny-by-default.
- `agbis_outbox` — CRM→Agbis reliability queue: entity/op/payload, attempts/max_attempts, next_attempt_at, claimed_at (per-row FOR UPDATE SKIP LOCKED), state. Deny-by-default.
- `agbis_api_log` — append-only audit of write attempts (command, http_status, error_code, dor_id/contr_id, billed, executed_api_count) for billing reconciliation; NO secrets. Deny-by-default.

### WazzupApiLog | wazzup_api_log | lib/wazzup/log.ts
- Created `20260615000003_wazzup_api_log`. Append-only audit of OUTBOUND Wazzup API actions. NO `billed` (Wazzup billing = subscription, not per-action).
- Table: id(uuid PK), command(text 'message.send'|'iframe.open'), op, direction(CHECK outbound|inbound, default outbound), crm_entity/crm_entity_id, manager_id(soft uuid, no FK), channel_id, chat_id, message_id, http_status, error_code(text), latency_ms, request/response(jsonb, NO secrets), created_at. Deny-by-default RLS (service-role only).
- Written by `logWazzupCall` (best-effort, swallows errors) from sendWhatsAppMessage (broadcasts/actions.ts) + getWazzupChatUrl/getWazzupGlobalChatUrl (lib/wazzup/actions.ts). No inbound webhook exists (chat lives in Wazzup iframe).

### Integrations monitoring | (pages) | app/(protected)/settings/integrations/
- Admin-only read pages (server components, redirect('/') if not admin): /settings/integrations (hub), /agbis, /telephony, /wazzup.
- Read aggregates via service-role (`lib/integrations/stats.ts`): getAgbisStats (paid=billed/free/errors/byCommand/ExecutedApiCount + cost estimate ≈3₽/cmd), getTelephonyStats (vpbx_calls + vpbx_events counts), getWazzupStats (wazzup_api_log). Period today|month in Asia/Almaty (UTC+5).
- Sidebar: nested "Интеграции" subsection under Админ group (sidebar.tsx NavParent). Standalone /settings/telephony config link folded in (reachable from /settings/integrations/telephony).

### CallLog | call_logs | app/(protected)/queue/actions.ts
- Table: id(uuid PK), client_id, manager_id, status(text), sub_status(text, nullable), reason, notes, next_call_date(date), next_call_time(text HH:MM), call_duration(int), call_score(int), audio_url, transcript, summary, external_call_id(links to vpbx_calls), created_at
- **status (top-level disposition):** `reached | not_reached | callback | declined | not_relevant` (type `CallStatus`, `queue/actions.ts:11`)
- **sub_status (detail):** ordered | callback_later | decline_expensive | decline_competitor | decline_not_needed | decline_quality | decline_season | decline_other | wrong_number | sent_whatsapp | unavailable | blocked | `auto_3_strikes` (`queue/actions.ts:14`)
  - NOTE: no DB CHECK constraint on status/sub_status — enforced only in app types. ???: should there be a CHECK constraint?
- Side effects on insert (recordDisposition `queue/actions.ts:81`): set client.last_called_at; release lock if held by caller; auto-assign manager if unassigned; **3-strike rule** — 3+ `not_reached` in 30 days auto-inserts a `not_relevant` / `auto_3_strikes` log (removes client from queue via the view filter).
- API/actions: recordDisposition, getClientCallHistory (signed audio URLs), getAttemptCount, getScheduledCallbacks, getDayStats, saveCallTranscript (`queue/actions.ts`)
- Pages: /queue (disposition form), /clients/[id] (history), /calls
- audio_url: stored as path/old URL; served as 1h signed URL from private `call-recordings` bucket (`queue/actions.ts:184`)
- Roles: insert authenticated; manager select own, admin select all
- RLS: `20260514000001_schema.sql:124` + app_metadata `20260611000004:72`

### VpbxCall | vpbx_calls | lib/vpbx/events.ts
- Table: id(uuid PK), vpbx_uuid(unique, onConflict key), external_call_id, direction(text CHECK outbound|inbound|internal), number_a, number_b, line_number, client_id(nullable→clients), manager_id(nullable→profiles), finish_status(CHECK ANSWERED|NOT_ANSWERED|BUSY|CANCELLED), duration(int>=0), is_recorded(bool), record_url, transcription_status(CHECK none|pending|done|failed), transcript, summary, score(int 1-10), started_at, answered_at, finished_at, created_at, updated_at
- CHECK constraints: `20260611000001_vpbx_telephony.sql:14,21,26,30`
- Populated by VPBX webhook events (CallStartEvent / CallStateEvent / CallFinishEvent) → upsert by vpbx_uuid (`events.ts:buildCallUpsert`, `processVpbxEvent:136`).
- client_id correlated by phone (`events.ts:160`); inbound calls get manager_id = client's assigned_manager_id so RLS shows them to that manager (`events.ts:183`).
- API/actions: webhook ingest (`app/api/vpbx/webhook/route.ts`), makeSipCall click-to-call (`lib/vpbx/actions.ts:21`), getClientVpbxCalls (`queue/actions.ts:416`), cron (`app/api/cron/vpbx/route.ts`)
- Pages: /calls, /queue (vpbx-calls-panel), /clients/[id]
- Roles: manager select own + unassigned inbound; admin select all (`20260611000004:104-117`)

### VpbxEvent | vpbx_events | lib/vpbx/events.ts
- Table: event_id(text PK — dedup key), vpbx_uuid, type, payload(jsonb), received_at
- Append-only idempotency ledger: duplicate event_id insert (PG 23505) ⇒ event already processed (`events.ts:145`). Retention: ??? (no cleanup job found).

### Profile | profiles | (handle_new_user trigger)
- Table: id(uuid PK = auth.users.id), email, name, role(text — `admin|manager`), is_active(bool), sip_extension(text), created_at, updated_at
- role synced from auth.users.**app_metadata.role** via handle_new_user trigger (`20260611000004:42`). profiles.role is a mirror, NOT the auth source — see Invariants §Role.
- API/actions: createEmployee (`team/actions.ts:242`, sets app_metadata.role via Admin API)
- Pages: /team, /settings (sip_extension personal settings)
- FK in: vpbx_calls.manager_id

### SalesPlan | sales_plans | app/(protected)/sales-plans/actions.ts
- Table: id(uuid PK), manager_id, month(int), year(int), carpets_target / furniture_target / curtains_target / repeat_target / dry_clean_target / blankets_target (all int tenge), created_at, updated_at
- Per-manager monthly revenue targets by service category. Drives day stats (getDayStats `queue/actions.ts:299`) and motivation.
- Pages: /sales-plans (admin), /motivation, /queue (day target derivation)
- Roles: admin manage all (`20260611000004:98`)

### BroadcastTemplate | broadcast_templates | app/(protected)/broadcasts/actions.ts
- Table: id(uuid PK), title, category(text default), created_by(uuid, nullable), created_at
- WhatsApp message scenario templates. AI generates message text per client from a template title.
- API/actions: getTemplates, createTemplate, deleteTemplate (`broadcasts/actions.ts:66,87,122`)
- Roles: delete = own OR admin (`20260611000004:67`)

### BroadcastLog | broadcast_logs | app/(protected)/broadcasts/actions.ts
- Table: id(uuid PK), client_id, manager_id, scenario, message_text, status(text), error_message, sent_at
- Append-only log of WhatsApp broadcast sends. status: ??? (sent/failed — verify enum).
- API/actions: logBroadcastAttempt, getBroadcastLogs (`broadcasts/actions.ts:348,415`)

### CrmSetting | crm_settings | (key-value config)
- Table: key(text PK), value(jsonb), updated_at
- Known keys: `segment_rules` (RFM config, §Segmentation), `day_target` (daily call target, default 40), `vpbx_can_call` (per-user click-to-call permission map `{userId: bool}`), Wazzup config keys (`lib/wazzup/config.ts`, `keys.ts`). Other keys: ???
- value is `Json` → always parse with `typeof`/safe parser, never `as` cast (`lib/segments.ts:parseSegmentConfig`).
- Roles: admin update only (`20260611000004:82`)

### Migration ledger | _migrations | scripts/migrate.mjs
- Table: name(PK), applied_at. Tracks applied SQL files. Managed by `npm run db:migrate` (Management API). Not a business entity.

---

## Rules

### Discount Calculation | app/(protected)/queue/order/actions.ts:12
- Tiered, highest tier wins (overwrites, not additive): repeat client (total_orders≥1) → 5%; amount > 30000 → 10%; 2+ services (complex) → 15%.
- discount_amount = Math.round(amount × percent / 100). Money stays integer tenge.
- UI mirror in order-form `calcDiscount` (`queue/order-form.tsx:27`) — keep in sync with server.

### RFM Segmentation | lib/segments.ts + compute_segment (SQL)
- Configurable rules in `crm_settings.segment_rules` (admin-editable). Ordered list, first match wins. Rule types: `days_gt` (days since last order >), `orders_gte` (total_orders ≥), `default`.
- Defaults: Потерянный(days>180) → В риске(days>90) → Постоянный(orders≥4) → Повторный(orders≥2) → Новый(default). (`lib/segments.ts:27`, SQL `20260611000005:23`)
- TS `computeSegment` MUST mirror SQL `compute_segment` — two implementations, one rule set. Override: clients.segment_override wins over computed.
- Colors: SEGMENT_COLORS fallback + per-rule color.

### Queue Lock | app/(protected)/queue/actions.ts:39
- lockClient: atomic conditional update — claims client only if `locked_by IS NULL OR locked_until < now()`. Lock TTL = 10 min (`LOCK_DURATION_MINUTES`). Prevents two managers calling the same client.
- unlockClient: releases only if locked_by = caller. Auto-released on recordDisposition.

### 3-Strike Rule | app/(protected)/queue/actions.ts:139
- 3 `not_reached` dispositions within 30 days (`MAX_ATTEMPTS=3`, `ATTEMPT_WINDOW_DAYS=30`) → auto `not_relevant`/`auto_3_strikes` log → client drops out of queue (view filter).

### Day Stats / Daily Target | app/(protected)/queue/actions.ts:263
- getDayStats: counts today's calls/reached/orders + revenue (Almaty timezone via `almatyTodayUtc`). Derives planRevenuePerDay = month target / 22 working days; planOrdersPerDay = revenue/17000 avg check; dayTargetCalls from crm_settings.day_target (default 40).
- ??? "22 working days" and "17000 avg check" are hardcoded magic numbers — confirm business values.

### Motivation | lib/motivation-formula.ts (формула), app/(protected)/motivation/actions.ts
- ЕДИНАЯ формула `computeBonus`/`computeFullPayout` (источник — Excel «Мотивация», лист «Настройки», извлечено из формул ячеек 2026-06-12, D-решение пользователя «excel»):
  - ставки: ковры 1.5%, мебель/шторы/повторные/пледы 3%, самовывоз 0.5%
  - коэффициент: <70% → 0; 70–100% → равен % выполнения; >100% → 1.2 СКАЧКОМ
  - джекпот 50 000: ЧЕТЫРЕ категории ≥100% (ковры+мебель+шторы+ПОВТОРНЫЕ — формула ячейки, текст листа врёт про 3)
  - полное «к выплате» = оклад 150 000 + бонусы категорий + джекпот + KPI (чек ≥19 500 → +25k; конверсия обзвона = заказы/звонки ≥25% → +25k; «обращение→заказ» вне CRM)
- Планы: sales_plans по manager_id/month/year (fallback Excel→дефолт). Ставки/оклад/KPI: crm_settings.motivation_config → DEFAULT_CONFIG (lib/motivation-excel.ts), дефолты = Excel.
- Контрольная сверка в tests/motivation-formula.test.ts (план Елены июнь, 100% → категории 221 494 + джекпот 50 000 + оклад = 421 494).

### Auto-assign | app/(protected)/team/actions.ts:359
- Unassigned clients (assigned_manager_id IS NULL) distributed across active managers. Also auto-assigned on first call/order (`queue/actions.ts:124`, `order/actions.ts:102`).

---

## Flows

### Call from queue → disposition | manager | /queue
- See queue → lock (lockClient) → click-to-call (makeSipCall, Beeline) OR WhatsApp → record outcome (recordDisposition) → optional create order (createOrder) → transcript+score saved (saveCallTranscript). Touches: Client, CallLog, VpbxCall, Order.

### Create order | manager | queue/order/actions.ts:createOrder → /queue/order
- Steps: validate services+amount → fetch client → calc discount → insert order → bump client aggregates → auto-assign if needed. Touches: Order, Client. Rules: Discount.

### Import clients (Excel) | admin | import/actions.ts:importClients → /import
- Admin-gated. Parses Excel (База Агбис), normalizes phone (E.164), upserts clients with aggregates. Touches: Client.

### Inbound VPBX call | system (webhook) | app/api/vpbx/webhook/route.ts → lib/vpbx/events.ts
- VPBX POSTs CallStart/State/Finish events (auth: `?s=secret`) → dedup by event_id → correlate client by phone → upsert vpbx_calls → inbound assigned to client's manager → CallFinish with recording → transcription pending. Touches: VpbxEvent, VpbxCall, Client.

### WhatsApp broadcast | manager | broadcasts/actions.ts → /broadcasts
- Filter clients (segment) → pick template → AI generates message (generateBroadcastMessage) → send via Wazzup (sendWhatsAppMessage) → log (logBroadcastAttempt). Touches: BroadcastTemplate, BroadcastLog, Client. External: Wazzup, OpenRouter/AI.

### Click-to-call | manager/admin | lib/vpbx/actions.ts:makeSipCall
- Admin always; manager allowed unless disabled in crm_settings.vpbx_can_call[userId]=false. Requires user sip_extension. Calls Beeline MakeCall2 (dial digits without +). Touches: VpbxCall.

---

## Invariants

### Money
- All monetary columns are **integer = whole tenge** (NOT tiyn/smallest-unit). Migrated `20260612000001_money_to_integer.sql`. Columns: clients.total_spent/avg_order_value, orders.amount/discount_amount, sales_plans.*_target.
- discount_percent is `numeric(5,2)` (a percentage, not money).
- Always `Math.round()` after any money multiplication/division (discount, avg, aggregates).

### Role / Authorization
- Role is read ONLY via `getUserRole(user)` from `lib/auth/get-user-role.ts` — sources `app_metadata.role` (writable only by service role), falls back to user_metadata.
- NEVER trust `user_metadata.role` for authorization (privilege escalation — D-2026-06-11). Set role for new users via Admin API `app_metadata` (`team/actions.ts:267`).
- RLS policies read `auth.jwt() -> 'app_metadata' ->> 'role'`. profiles.role is a mirror via trigger, not the source.
- Server actions gate admin work with `requireAdmin()` (`lib/auth/roles.ts`) or inline `getUserRole(user) !== 'admin'`.

### Phone numbers
- Canonical storage = E.164 Kazakhstan `+7XXXXXXXXXX` via `lib/phone.ts:normalizePhone`. Use `toDialDigits` for Beeline/Wazzup (no +), `toE164` for tel:/display. `isValidPhone` = `/^\+7\d{10}$/`.

### RLS
- Enabled on all business tables, default deny. Admin = app_metadata.role='admin' (full); manager = own rows (manager_id=auth.uid()) + select-all clients + lock + unassigned-inbound calls.
- orders has NO DELETE RLS policy → admin deletes via admin client after in-code role check (`orders/actions.ts:26`).
- client_segments view uses `security_invoker = true` so caller RLS applies (`20260611000002`).

### Idempotency
- VPBX webhook dedups by vpbx_events.event_id PK (23505 ⇒ duplicate). vpbx_calls upsert keyed on vpbx_uuid.

### Timezone
- Business "today" = Almaty UTC+5. Computed in JS (`almatyTodayUtc`, `getScheduledCallbacks` `queue/actions.ts:254`). No DST. Store timestamptz (UTC), filter by Almaty day boundaries.

---

## Permissions

Two roles: `admin` (руководитель), `manager` (менеджер). Enforced at 3 layers: middleware (route), server action (requireAdmin/getUserRole), RLS (row).

| Module / Route | admin | manager | Gate |
|---|---|---|---|
| /dashboard | yes | — (redirect) | middleware ADMIN_ROUTES + requireAdmin in actions; root `/` и login редиректят admin сюда |
| /queue | yes | yes | authenticated |
| /clients, /clients/[id] | yes | yes (select all) | RLS |
| /orders | yes (incl. delete) | view own | deleteOrder admin-only |
| /calls, /inbox, /pipeline | yes | yes (own rows) | RLS |
| /broadcasts | yes | yes | authenticated |
| /motivation, /sales-plans | yes (manage) | view own ??? | RLS admin manage |
| /import | yes | — (redirect) | middleware ADMIN_ROUTES + importClients gate |
| /team | yes | — (redirect) | middleware ADMIN_ROUTES + getTeamPerformance/createEmployee gate |
| /settings/telephony | yes | — (redirect) | middleware ADMIN_ROUTES |
| /settings/segments | yes | — (redirect) | middleware ADMIN_ROUTES |
| /settings (personal) | yes | yes | authenticated |
| click-to-call (makeSipCall) | yes | yes unless crm_settings.vpbx_can_call[uid]=false | inline |

Source: `middleware.ts:6` (ADMIN_ROUTES), per-action `getUserRole`/`requireAdmin`, RLS policies in migrations.

---

## Infrastructure

### Pages/actions added 2026-06-12 (Ф3/Ф4)
- `components/call-work-panel.tsx` — ЕДИНАЯ панель звонка (queue+clients), state-машина callPhase, hotkeys, снуз, scriptText слот.
- `components/global-search.tsx` + `app/(protected)/search-actions.ts` — Ctrl+K поиск клиентов, бейдж перезвонов сайдбара.
- `app/(protected)/dashboard/` — дашборд руководителя (admin-only): сегодня по менеджерам, план-факт+прогноз, мини-воронка, низкие call_score.
- `app/(protected)/pipeline/actions.ts` — честная воронка count:exact + разрез по менеджерам.
- `lib/motivation-formula.ts` — ЕДИНАЯ формула бонуса (грейды+джекпот); калькулятор менеджера и ведомость админа (`motivation/bonus-payroll-client.tsx`, CSV) считают только через неё.
- Правило статистики: WhatsApp-отправки = `sub_status='sent_whatsapp'`, исключаются из «Звонков» фильтром `.or(sub_status.is.null,sub_status.neq.sent_whatsapp)` (обычные звонки имеют sub_status NULL — голый .neq их потеряет).

### FilterBar (этап 1, 2026-06-12)
- `components/filter-bar.tsx` + `filter-value-editor.tsx` — конструктор фильтров (чипы, «+ Фильтр», AND, одно условие на поле). Страницы: /clients, /queue.
- `lib/filters/` — модель: `types.ts` (Zod conditionSchema), `client-fields.ts` (реестр полей = whitelist), `apply.ts` (условия → supabase-билдер; days_since_* транслируются в даты), `dates.ts` (Алматы UTC+5, относительные пресеты), `url.ts` (?f= сериализация), `summary.ts` (текст чипа).
- Новое фильтруемое поле = запись в client-fields.ts + ветка в apply.ts. Сервер валидирует через validateConditions (whitelist).
- rfm_segment фильтруется только через view client_segments (getClientsList маршрутизирует needsSegmentsView). View расширен миграцией `20260612000006` (created_at, avg_order_value, next_action_at, sticky_note).
- Этап 2 (готово 2026-06-12): кросс-сущностные условия через embed !inner (tags, order_service, decline_reason, call_score); «рассылка без заказа» через RPC `broadcast_no_order_ids` (cap 1000 ids); сохранённые фильтры (`saved_filters`, общие на команду, RLS: delete = creator/admin); «Выбрать всю выборку» → `getClientIdsByFilter` (cap 5000) + чанкованные bulk-апдейты (200/чанк).
- Этап 3 (готово 2026-06-12):
  - Теги: `tags` + `client_tags` (миграция 0007, RLS: команда видит всё). Компонент `components/client-tags.tsx` (панель звонка + карточка + фильтр). Создание где угодно — справочник общий.
  - Источник: `acquisition_sources` (строгий справочник, 7 сидов, менять может только админ) + `clients.acquisition_source_id/acquisition_answer_raw` (миграция 0008). Классификация ответа — `lib/acquisition/classify.ts` (Groq, only high-confidence из списка; ИИ источники НЕ создаёт). Очередь разбора = raw без source → `/settings/sources` (админ). Автоизвлечение из транскриптов: scoreCall возвращает acquisitionAnswer → `lib/acquisition/store.ts` (не перезаписывает, ошибки глотает). Компонент `components/acquisition-field.tsx`.
  - View client_segments расширен acquisition_source_id (миграция 0011); словарь услуг — RPC `distinct_order_services` (0012).

### Scripts (package.json)
- `npm run dev` / `build` / `start` — Next.js 16.
- `npm run test` — vitest (200 tests, 2026-06-12).
- `npm run db:migrate` — apply SQL migrations via Supabase **Management API** (`scripts/migrate.mjs`); ledger `public._migrations`.
- `npm run db:migrate:status` — show applied/pending migrations.
- `npm run gen:types` — regenerate `types/database.ts` (`scripts/gen-types.mjs`). Run + commit after every migration.

### Deploy
- **No git integration.** Deploy only via CLI: `npx vercel deploy --prod` (D-2026-06-11).
- Migrations applied separately via db:migrate before/with deploy.

### Stack
- Next.js 16.2.9, React 19.2.4, Supabase (@supabase/ssr 0.10, supabase-js 2.105), @base-ui/react, lucide-react, pg (migrate script), Deepgram SDK (transcription), Zod.
- AI: OpenRouter (WhatsApp message gen, call scoring). Transcription: Deepgram (`lib/transcription/core.ts`).
- Telephony: Beeline VPBX (`lib/vpbx/`). WhatsApp: Wazzup (`lib/wazzup/`).

### API routes
- POST /api/vpbx/webhook — VPBX events (auth `?s=secret`, public, bypasses middleware)
- GET/POST /api/cron/vpbx — VPBX subscription/maintenance cron (public, bypasses middleware)
- /api/transcribe, /api/score, /api/call-tips — AI helpers
- /api/vpbx/recording — recording fetch/proxy

### Storage
- `call-recordings` bucket — **private**, served via 1h signed URLs (D-2026-06-11). MicroSIP local MP3s synced from browser via File System Access API (`lib/recordings/`, recording-sync-daemon) into a per-manager folder `local/<manager_uid>/` (D-2026-06-15); INSERT RLS restricts each manager to their own folder.

---

## Known unknowns (???)

- call_logs.status / sub_status — no DB CHECK constraint (app-types only). Add constraint?
- broadcast_logs.status — exact enum values (sent/failed?) unverified.
- crm_settings — full set of keys beyond segment_rules / day_target / vpbx_can_call / wazzup_*.
- vpbx_events / broadcast_logs — retention/cleanup policy (append-only, no cron found).
- getDayStats magic numbers: 22 working days, 17000 avg check — confirm as business constants.
- /motivation, /sales-plans manager-level read access (view own vs none) — verify RLS/UI.
