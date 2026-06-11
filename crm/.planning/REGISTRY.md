# REGISTRY — Dara Clean CRM

> Knowledge index for the repeat-sales CRM (Next.js 16 + Supabase).
> POINTERS to code, not copies. Read the relevant entity card BEFORE editing.
> Source of truth for schema: `types/database.ts` (regen via `npm run gen:types`).
> Last reviewed: 2026-06-12 (Foundation F3).

---

## Entities

11 tables + 1 view. RLS enabled on every business table (default deny).

### Client | clients | lib/segments.ts
- Table: id(uuid PK), name, phone(E.164 unique), address, assigned_manager_id(uuid→profiles, nullable), total_orders(int), total_spent(int tenge), avg_order_value(int tenge), last_order_date(date), last_called_at(timestamptz), locked_by(uuid, nullable), locked_until(timestamptz, nullable), segment_override(text, nullable = auto), created_at, updated_at
- Aggregates (total_orders/total_spent/avg_order_value/last_order_date) are maintained in **app code**, not DB triggers: createOrder (`app/(protected)/queue/order/actions.ts:82`) and deleteOrder recompute (`app/(protected)/orders/actions.ts:56`).
- segment_override: manual RFM override; NULL = computed live by `compute_segment`.
- locked_by/locked_until: queue lock (10 min) — see Rules §Queue Lock.
- API/actions: import (`import/actions.ts:importClients`), lock/unlock (`queue/actions.ts:39,61`), assign (`team/actions.ts:autoAssignUnassignedClients`, assign-button), clients page actions (`clients/actions.ts`)
- Pages: /clients, /clients/[id], /queue (reads via client_segments), /broadcasts
- FK in: orders.client_id, call_logs.client_id, vpbx_calls.client_id, broadcast_logs.client_id
- Roles: admin (insert/update/delete via RLS); manager (select all, lock own); see Permissions
- RLS: `20260514000001_schema.sql:71` (select all authenticated, insert/update/delete admin, manager can lock)

### ClientSegments (VIEW) | client_segments | migration 20260611000005 / 20260612000001
- View over clients with `security_invoker = true` (RLS of caller respected).
- Adds: rfm_segment = coalesce(segment_override, compute_segment(total_orders, last_order_date)); days_since_last_order = current_date − last_order_date.
- Filter: excludes clients whose **latest** call_log status is `declined` or `not_relevant` (i.e. dead leads hidden from queue). Definition: `20260612000001_money_to_integer.sql:49`.
- Used by: /queue (the calling queue source), /clients, broadcasts.

### Order | orders | app/(protected)/queue/order/actions.ts
- Table: id(uuid PK), client_id(uuid→clients), manager_id(uuid), services(text[]), amount(int tenge), discount_percent(numeric(5,2)), discount_amount(int tenge), comment, created_at
- No status field — orders are a single financial record (no lifecycle state machine).
- Side effects on create: bump client aggregates, set last_order_date, auto-assign manager if unassigned (`order/actions.ts:82-109`).
- Side effects on delete (admin only): recompute client aggregates (`orders/actions.ts`).
- API/actions: createOrder (`queue/order/actions.ts:30`), deleteOrder (`orders/actions.ts:8`, admin-gated)
- Pages: /orders, /queue/order (order form within call flow)
- Roles: manager+admin insert; manager select own, admin select all; **delete admin-only** (no DELETE RLS policy → done via admin client, `orders/actions.ts:26`)
- RLS: `20260514000001_schema.sql:102` + app_metadata switch `20260611000004:88`
- Rules: Discount (§Discount Calculation)

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

### Motivation | app/(protected)/motivation/actions.ts:65
- getMotivationStats: aggregates order revenue per service category vs sales_plan targets per manager/month. Excel export via `lib/motivation-excel.ts`. Conversion = reached/calls.

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

### Scripts (package.json)
- `npm run dev` / `build` / `start` — Next.js 16.
- `npm run test` — vitest (~133 tests).
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
- `call-recordings` bucket — **private**, served via 1h signed URLs (D-2026-06-11). MicroSIP local MP3s synced from browser via File System Access API (`lib/recordings/`, recording-sync-daemon).

---

## Known unknowns (???)

- call_logs.status / sub_status — no DB CHECK constraint (app-types only). Add constraint?
- broadcast_logs.status — exact enum values (sent/failed?) unverified.
- crm_settings — full set of keys beyond segment_rules / day_target / vpbx_can_call / wazzup_*.
- vpbx_events / broadcast_logs — retention/cleanup policy (append-only, no cron found).
- getDayStats magic numbers: 22 working days, 17000 avg check — confirm as business constants.
- /motivation, /sales-plans manager-level read access (view own vs none) — verify RLS/UI.
