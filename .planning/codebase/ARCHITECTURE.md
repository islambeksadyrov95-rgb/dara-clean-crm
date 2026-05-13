<!-- refreshed: 2026-05-13 -->
# Architecture

**Analysis Date:** 2026-05-13

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     DATA SOURCES (external)                         │
│  Google Sheets "Финансы DaraClean"  |  Excel/CSV exports            │
│  Google Ads / Yandex / 2GIS APIs   |  PDF payment reports           │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│  Telegram Bot            │   │  ETL Pipeline (Python)               │
│  `Telegram Bot/src/`     │   │  `etl/`  +  `scripts/`               │
│  grammY + TypeScript     │   │  merge_build.py → dashboard-data.json│
│  Live read/write to      │   │  finance_dds.py, geocode.js, etc.    │
│  Google Sheets via API   │   │  Output: `dashboard/data/*.json`      │
└──────────────────────────┘   └──────────────────┬───────────────────┘
                                                  │
                                                  ▼
                               ┌──────────────────────────────────────┐
                               │  Dashboard SPA (vanilla JS)          │
                               │  `dashboard/index.html`              │
                               │  Static file served locally/http     │
                               │  Reads pre-built JSON at page load   │
                               └──────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Router | Hash-based SPA navigation, page switching, breadcrumb updates | `dashboard/js/router.js` |
| main.js | App bootstrap, JSON data load, route registration | `dashboard/js/main.js` |
| FinanceDashboard | Finance P&L views: overview, 2025 fact, 2026 plan, calendar | `dashboard/js/finance-dashboard.js` |
| FinanceData | Hardcoded monthly fact/plan data (2025–2026) + loan repayments | `dashboard/js/finance-data.js` |
| CostModel | COGS block breakdown, break-even, CAC/LTV, channel budgets | `dashboard/js/cost-model.js` |
| ScenarioEngine | localStorage-persisted CFO planning with revenue/growth sliders | `dashboard/js/scenario-engine.js` |
| SalesDashboard | Managers, channels, clients, plan views from `DashboardData` JSON | `dashboard/js/sales-dashboard.js` |
| SalesFunnel | Sales funnel data engine | `dashboard/js/sales-funnel.js` |
| FunnelAnalytics | Cross-channel funnel UI with month selector | `dashboard/js/funnel-analytics.js` |
| UnitEconomics | CAC, marketing efficiency, 2026–2028 growth model | `dashboard/js/unit-economics.js` |
| HeatmapDashboard | Geographic heatmap of client addresses via 2GIS MapGL | `dashboard/js/heatmap-dashboard.js` |
| Analytics | Analytics utilities shared across modules | `dashboard/js/analytics.js` |
| Bot index.ts | grammY bot bootstrap, session, middleware, command routing | `Telegram Bot/src/index.ts` |
| sheetsClient.ts | All Google Sheets CRUD: entries, DDS, balances, dictionary | `Telegram Bot/src/sheetsClient.ts` |
| access.ts | User access list in "Доступ" sheet, invite codes, RBAC | `Telegram Bot/src/access.ts` |
| wizard.ts | Multi-step addEntryConversation for recording transactions | `Telegram Bot/src/handlers/wizard.ts` |
| dds.ts | DDS (cash flow statement) reader with month/quarter drill-down | `Telegram Bot/src/handlers/dds.ts` |
| balance.ts | Account balance aggregation from "Ежедневно" sheet | `Telegram Bot/src/handlers/balance.ts` |
| ETL merge_build.py | Main assembler: merges marketing, sales, finance into `dashboard-data.json` | `etl/merge_build.py` |
| finance_dds.py | Reads DDS Excel sheets and structures cash-flow data | `etl/finance_dds.py` |
| geocode scripts | Address geocoding via 2GIS API → `geocoded-addresses.json` | `scripts/geocode-2gis-v2.js` |

## Pattern Overview

**Overall:** Multi-subsystem monorepo — three independent runtimes sharing no runtime code.

**Key Characteristics:**
- Dashboard is a zero-build vanilla JS SPA: no bundler, no framework, no SSR. All JS is IIFE-wrapped and registers on `window.*` globals.
- Telegram Bot is a Node.js/TypeScript long-polling bot compiled with `tsc` and hosted on Railway.
- ETL is an offline Python pipeline run manually to regenerate static JSON before publishing the dashboard.
- No shared database — the source of truth is Google Sheets. The dashboard reads pre-built JSON snapshots; the bot reads Sheets live.

## Layers

**Dashboard — Data Layer:**
- Purpose: Static JSON snapshots consumed at page load
- Location: `dashboard/data/`
- Contains: `dashboard-data.json` (ETL output), `geocoded-addresses.json`, `almaty-districts.json`, `sample-data.json`
- Depends on: ETL pipeline to rebuild
- Used by: All dashboard JS modules via `window.DashboardData`, `window.FinanceFullData`

**Dashboard — Business Logic Layer:**
- Purpose: Financial calculations, models, aggregations
- Location: `dashboard/js/`
- Contains: `finance-data.js` (hardcoded fact/plan), `cost-model.js` (COGS/CAC), `scenario-engine.js` (CFO planning), `sales-funnel.js`
- Depends on: Data layer globals
- Used by: Render modules

**Dashboard — Render Layer:**
- Purpose: DOM manipulation, Chart.js rendering, HTML string injection
- Location: `dashboard/js/`
- Contains: `finance-dashboard.js`, `sales-dashboard.js`, `unit-economics.js`, `funnel-analytics.js`, `heatmap-dashboard.js`, `ui.js`
- Depends on: Business logic globals (`window.DaraCostModel`, `window.DashboardData`)
- Used by: Router callbacks

**Dashboard — Routing Layer:**
- Purpose: Hash-based page switching, period filter, breadcrumbs
- Location: `dashboard/js/router.js`
- Depends on: `window` hashchange events
- Used by: `main.js` to register route handlers

**Bot — Infrastructure Layer:**
- Purpose: Bot lifecycle, session, middleware chain
- Location: `Telegram Bot/src/index.ts`
- Contains: grammY bot instance, `requireAccess` middleware, global ReplyKeyboard injection

**Bot — Data Access Layer:**
- Purpose: All Google Sheets reads/writes
- Location: `Telegram Bot/src/sheetsClient.ts`, `Telegram Bot/src/access.ts`
- Depends on: `google-spreadsheet`, `google-auth-library` (JWT service account)
- Used by: All handlers

**Bot — Handler Layer:**
- Purpose: User-facing command and message handlers
- Location: `Telegram Bot/src/handlers/`
- Contains: `wizard.ts` (entry conversation), `dds.ts`, `balance.ts`, `stats.ts`, `onboarding.ts`, `access-panel.ts`, `reminder.ts`
- Depends on: sheetsClient, shared utilities

**ETL — Pipeline Layer:**
- Purpose: Offline data transformation from multiple sources to `dashboard-data.json`
- Location: `etl/`
- Contains: `merge_build.py` (orchestrator), `finance_dds.py`, `sales_from_sheet.py`, `marketing_*.py`, `two_gis_connections.py`

## Data Flow

### Dashboard: Initial Load

1. Browser opens `dashboard/index.html`
2. `main.js` fires on `DOMContentLoaded` (`dashboard/js/main.js:201`)
3. Parallel fetch of `data/dashboard-data.json` + `data/finance-full-data.json` (`main.js:36`)
4. Results stored on `window.DashboardData` and `window.FinanceFullData`
5. Modules register render handlers with `Router.on()` (`main.js:46-76`)
6. `Router.init()` fires, navigates to current hash (default `#overview`) (`router.js:88`)
7. Registered render function is called, injects HTML into page's `<div id="page-*">` slot

### Dashboard: Navigation

1. User clicks nav item → `location.hash` changes
2. `Router` catches `hashchange`, hides all `.page` elements, shows matching `page--id`
3. Registered handler for that hash is called, renders content into DOM
4. Charts: each module tracks its Chart.js instances in local array, destroys before re-render

### Bot: Record Transaction (Happy Path)

1. User taps "Добавить операцию" → `bot.hears()` catches text (`index.ts:215`)
2. `ctx.conversation.enter('addEntryConversation')` starts multi-step wizard (`handlers/wizard.ts`)
3. Wizard reads dictionary once from Sheets via `getDict()` (cached in `dict.ts`)
4. User steps through 7 fields: date → type → payment → amount → category → article → comment
5. On confirm: `sheets.addEntry(row)` writes to "Ежедневно" sheet using `getCellByA1()` + `saveUpdatedCells()`
6. Bot sends confirmation and returns to main menu

### Bot: Access Request Flow

1. User sends `/start` → checks `access.isApproved()` against "Доступ" sheet cache
2. If unapproved: `access.requestAccess()` writes pending record to sheet
3. Approved admins receive inline approve/reject keyboard
4. On approve: `access.approveUser()` updates sheet status, bot sends onboarding to new user

### ETL: Data Refresh

1. Analyst runs `python etl/merge_build.py --google ... --sales ... --finance ...`
2. `merge_build.py` loads Google Ads CSVs, Yandex CSV, 2GIS XLSX, Sales XLSX, Finance XLSX
3. Deduplication, FX conversion (USD→KZT via NBRK rates), aggregation
4. Output written to `dashboard/data/dashboard-data.json`
5. Dashboard refreshed by reloading in browser

**State Management:**
- Dashboard: no reactive state. Each navigation re-renders from globals. Editable user plans stored in `localStorage` under `dc-*` keys (scenario-engine, goals, etc.).
- Bot: session stored in memory (in-process, resets on restart) via grammY `session()`. Access list cached in module variable with TTL (`access.ts:46`).

## Key Abstractions

**Window Globals (Dashboard):**
- Purpose: Cross-module communication in no-bundler environment
- Pattern: each JS file is an IIFE that registers `window.SomeName = { ... }` before returning
- Examples: `window.DC.fmt` (formatters), `window.DashboardData` (JSON payload), `window.DaraCostModel` (cost model API), `window.FinanceDashboard`, `window.HeatmapDashboard`

**BotContext (Bot):**
- Purpose: Typed grammY context with session + conversations flavor
- Location: `Telegram Bot/src/types.ts`
- Pattern: `type BotContext = ConversationFlavor<Context & SessionFlavor<SessionData>>`

**Chart Registry (Dashboard):**
- Purpose: Prevent Chart.js memory leaks on re-render
- Pattern: Each render module keeps a local `charts` array/object; calls `.destroy()` before recreating
- Example: `dashboard/js/finance-dashboard.js:13-17`, `dashboard/js/sales-dashboard.js:12-15`

## Entry Points

**Dashboard:**
- Location: `dashboard/index.html` + `dashboard/js/main.js`
- Triggers: Browser open (file:// or local http server)
- Responsibilities: Load JSON data, register all routes, start router

**Telegram Bot:**
- Location: `Telegram Bot/src/index.ts`
- Triggers: `node dist/index.js` (Railway deployment)
- Responsibilities: Create bot, register middleware and handlers, start long polling

**ETL:**
- Location: `etl/merge_build.py`
- Triggers: Manual CLI execution with source file path arguments
- Responsibilities: Assemble `dashboard-data.json` from raw exports

## Architectural Constraints

- **No bundler on dashboard:** All JS files loaded via `<script>` tags in `index.html`. Load order matters — `main.js` must load after all module scripts.
- **Global namespace:** Dashboard modules communicate via `window.*`. Name collisions would silently break rendering.
- **Bot session is in-memory only:** No database for session. Restart clears all active wizard states.
- **Google Sheets as DB:** Both bot and ETL read from same spreadsheet. No connection pooling; concurrent requests each open their own connection. Sheet rows are indexed by position, not by a stable primary key.
- **ETL is offline/manual:** Dashboard data is a static snapshot. Stale data is expected between ETL runs. There is no automatic scheduled rebuild.
- **No API server:** Dashboard has no backend. All computation happens client-side from pre-built JSON.
- **Circular chart management risk:** Modules that render charts must always call destroy before re-render. Missing this causes `canvas is already in use` errors.

## Anti-Patterns

### Duplicate sheetsClient Instances

**What happens:** Both `sheetsClient.ts` and `access.ts` each create their own `new GoogleSpreadsheet(...)` instance with separate `docLoaded` state.
**Why it's wrong:** Two independent document loads on each startup; potential for one to be stale if sheets structure is checked only once per instance.
**Do this instead:** Extract a shared `getDoc()` singleton into a separate module, import it from both clients.

### Hardcoded Financial Data in JS

**What happens:** `finance-data.js` contains monthly revenue/expense arrays typed out directly in code. `cost-model.js` contains channel budgets, CAC, LTV values as JS constants.
**Why it's wrong:** Any data change requires code edit. Easy to have dashboard and ETL JSON out of sync.
**Do this instead:** These values should come from `dashboard-data.json`. Currently the JSON and hardcoded arrays serve as overlapping sources of truth.

## Error Handling

**Strategy:**

- Bot: global `bot.catch()` handler replies with error text to user (`index.ts:246`). Individual handlers do not have try/catch — errors bubble to global handler.
- Dashboard: render functions check for missing globals (`if (!CM) { console.error(...); return }`). No user-visible error state beyond loading indicators.
- ETL: Python scripts use standard exceptions; no retry logic. Preflight checks available via `preflight_sources.py`.

**Patterns:**
- Bot silently ignores admin notification failures with `try { } catch { /* ignore */ }` (`index.ts:128`)
- Dashboard render functions return early without user feedback when data is unavailable

## Cross-Cutting Concerns

**Formatting:** `window.DC.fmt` exposes `money()`, `num()`, `pct()` — defined in `dashboard/js/main.js:8-18`. All dashboard modules call `fmt()` function that falls back to inline formatter if `DC` not yet loaded.
**Validation:** Bot uses zod schema for env vars (`Telegram Bot/src/env.ts:4`). No input validation on dashboard (read-only).
**Authentication:** Bot enforces `requireAccess` middleware for all messages except `/start` and access callbacks (`index.ts:181`). Dashboard has no auth — purely local tool.
**Localization:** All user-facing text is Russian. Dates in "ДД.ММ.ГГГГ" format in Sheets; ISO-8601 internally in ETL/dashboard.

---

*Architecture analysis: 2026-05-13*
