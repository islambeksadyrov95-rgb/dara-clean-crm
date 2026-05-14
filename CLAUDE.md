<!-- GSD:project-start source:PROJECT.md -->
## Project

**Dara Clean CRM**

CRM-система повторных продаж для химчистки ковров Dara Clean (Алматы). Менеджеры обзванивают клиентов по базе, создают заказы, отправляют WhatsApp напоминания. Руководитель видит аналитику, настраивает мотивацию и оценивает финансовый эффект скидок.

**Core Value:** Менеджер открывает систему, видит кому звонить сегодня, звонит, и за 2 клика создаёт заказ или отправляет WhatsApp — без Excel, без ручного поиска, без дублирования звонков между менеджерами.

### Constraints

- **Timeline**: MVP в боевом режиме к 15 мая 2026 (завтра)
- **Tech stack**: Next.js + Supabase (PostgreSQL + Auth) + Vercel
- **Users**: 3-5 менеджеров + руководитель, все через браузер на компе
- **Data source**: Excel импорт (База Агбис.xlsx), позже API Агбис
- **AI**: OpenRouter API для генерации WhatsApp сообщений
- **Budget**: Supabase Free/Pro, Vercel Free/Pro, OpenRouter pay-per-use
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES2022) — Dashboard SPA (`dashboard/js/`)
- TypeScript (strict, ESM) — Telegram Bot (`Telegram Bot/src/`)
- Python 3.11 — ETL pipeline (`etl/`)
- JavaScript (Apps Script) — Google Sheets backend (`Telegram Bot/apps-script/`)
## Runtime
- Node.js v24.13.0 (dashboard dev server + Telegram Bot)
- Python 3.11.8 (ETL scripts)
- npm (lockfile: `dashboard/package-lock.json`, `Telegram Bot/package-lock.json`)
- Both lockfiles present
## Frameworks
- No framework — vanilla JS IIFE modules, hash-based router (`dashboard/js/router.js`)
- Chart.js 4.4.6 — charts (CDN: `cdn.jsdelivr.net`)
- SheetJS (xlsx) 0.20.2 — Excel export (CDN: `cdn.sheetjs.com`)
- grammY 1.23.1 — Telegram Bot framework (`Telegram Bot/src/index.ts`)
- @grammyjs/conversations 2.1.1 — multi-step wizard flows
- @grammyjs/menu 1.3.1 — inline keyboard menus
- Playwright 1.59.1 — E2E tests for dashboard (`dashboard/playwright.config.mjs`), Chromium headless
- Custom Node.js test runner — `dashboard/tests/compute.test.mjs`, `dashboard/tests/verify-invariants.mjs`
- tsc 5.7.3 → `dist/` — Telegram Bot compilation (`Telegram Bot/tsconfig.json`)
- tsx 4.19.2 — dev hot-reload (`tsx watch src/index.ts`)
- npx serve — dashboard dev server on port 3399
## Key Dependencies
- `grammy` 1.23.1 — core bot framework, long polling, session middleware
- `@grammyjs/conversations` 2.1.1 — multi-step entry wizard (`Telegram Bot/src/handlers/wizard.ts`)
- `google-spreadsheet` 5.2.0 — Google Sheets CRUD client
- `google-auth-library` 10.6.2 — JWT service account auth for Sheets API
- `zod` 3.23.8 — env var validation (`Telegram Bot/src/env.ts`) and API response schemas
- `dotenv` 16.4.5 — environment loading
- Chart.js 4.4.6 — financial/sales charts (loaded via CDN, no npm install)
- xlsx 0.18.5 (npm dev) — Excel generation for plan export
- SheetJS 0.20.2 (CDN) — client-side Excel in browser
- `openpyxl>=3.1.0` — Excel read/write (`etl/requirements.txt`)
- `pandas>=2.0.0` — data transformation
- `pdfplumber>=0.11.0` — PDF table extraction
- `xlrd>=2.0.1` — legacy Excel format reading
- `typescript` 5.7.3
- `eslint` 9.20.1 + `@typescript-eslint/*`
- `prettier` 3.4.2
## Configuration
- `BOT_TOKEN` — Telegram Bot API token
- `GOOGLE_SPREADSHEET_ID` — target Google Sheet ID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — GCP service account email
- `GOOGLE_PRIVATE_KEY` — RSA private key (with `\n` escaping)
- `TZ` — timezone, default `Asia/Almaty`
- Validated at startup via Zod (`Telegram Bot/src/env.ts`)
- `target: ES2022`, `module: ES2022`, `moduleResolution: Bundler`
- `strict: true`, `sourceMap: true`
- Output: `dist/`, source: `src/`
- testDir: `./tests/e2e`
- Viewport: 1440×900
- Web server: `npx serve . -l 3399`
- Screenshots on failure only
## Platform Requirements
- Node.js v24+ (confirmed in environment)
- Python 3.11+
- Windows 10 + Git Bash (project runs on Windows, Unix paths used in scripts)
- Telegram Bot: Railway (long polling, not webhook)
- Dashboard: static file server (serve, Vercel, or `file://` local open)
- Bot timezone: `Asia/Almaty` (UTC+5, Almaty, Kazakhstan)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Two Codebases, Two Styles
- **`dashboard/`** — vanilla JS, no build step, IIFE modules, no linter configured
- **`Telegram Bot/src/`** — TypeScript ESM, compiled via `tsc`, ESLint + Prettier configured
## dashboard/ — Vanilla JS Conventions
### Module Pattern
### Naming Patterns
### Code Style
- 2-space indentation throughout
- Single quotes for strings
- No trailing semicolons on statements (Prettier-style — but no Prettier configured, enforced manually)
- Arrow functions for short helpers: `const sum = (arr, pick) => arr.reduce((s, x) => s + pick(x), 0)`
- Regular `function` declarations for named render functions
### Import Organization (dashboard)
### Formatting Utilities
### Error Handling (dashboard)
- `console.error(message)` for missing module dependencies
- `try { ... } catch (e) { console.error(..., e) }` for render functions called by Router
- `try { ... } catch { /* ignore */ }` for cleanup (chart destroy, localStorage)
- `console.warn(...)` for non-critical async failures (e.g., data loading)
- No user-facing error UI — pages silently render empty on failure
### Chart Management
### Comments
- Business logic comments in Russian: `// Доля маркетинга в COGS (факт 2025)`
- Source attribution always present: `// Источник: Excel «Для анализа.xlsx»`
- Section headers use box-drawing dividers
- Data derivation formulas documented inline:
## Telegram Bot/src/ — TypeScript Conventions
### Naming Patterns
### Code Style
### Environment Variables
### Error Handling (Telegram Bot)
- `try { ... } catch { /* ignore */ }` for best-effort cleanup (delete message)
- Throw `Error` with Russian message for domain errors: `throw new Error('Лист "X" не найден')`
- No global error boundary — grammY handles uncaught errors per update
### Import Organization (Telegram Bot)
## ETL (etl/) — Python Conventions
## Shared Conventions (Both JS and TS)
- Month arrays always defined as `MONTHS_SHORT` (3-letter) and `MONTHS_FULL` (full Russian names)
- Russian locale formatting via `Intl.NumberFormat('ru-RU', ...)` — never manual string formatting
- Date handling: ISO 8601 strings (`YYYY-MM-DD`) for data, `DD.MM.YYYY` only for Google Sheets display
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- Dashboard is a zero-build vanilla JS SPA: no bundler, no framework, no SSR. All JS is IIFE-wrapped and registers on `window.*` globals.
- Telegram Bot is a Node.js/TypeScript long-polling bot compiled with `tsc` and hosted on Railway.
- ETL is an offline Python pipeline run manually to regenerate static JSON before publishing the dashboard.
- No shared database — the source of truth is Google Sheets. The dashboard reads pre-built JSON snapshots; the bot reads Sheets live.
## Layers
- Purpose: Static JSON snapshots consumed at page load
- Location: `dashboard/data/`
- Contains: `dashboard-data.json` (ETL output), `geocoded-addresses.json`, `almaty-districts.json`, `sample-data.json`
- Depends on: ETL pipeline to rebuild
- Used by: All dashboard JS modules via `window.DashboardData`, `window.FinanceFullData`
- Purpose: Financial calculations, models, aggregations
- Location: `dashboard/js/`
- Contains: `finance-data.js` (hardcoded fact/plan), `cost-model.js` (COGS/CAC), `scenario-engine.js` (CFO planning), `sales-funnel.js`
- Depends on: Data layer globals
- Used by: Render modules
- Purpose: DOM manipulation, Chart.js rendering, HTML string injection
- Location: `dashboard/js/`
- Contains: `finance-dashboard.js`, `sales-dashboard.js`, `unit-economics.js`, `funnel-analytics.js`, `heatmap-dashboard.js`, `ui.js`
- Depends on: Business logic globals (`window.DaraCostModel`, `window.DashboardData`)
- Used by: Router callbacks
- Purpose: Hash-based page switching, period filter, breadcrumbs
- Location: `dashboard/js/router.js`
- Depends on: `window` hashchange events
- Used by: `main.js` to register route handlers
- Purpose: Bot lifecycle, session, middleware chain
- Location: `Telegram Bot/src/index.ts`
- Contains: grammY bot instance, `requireAccess` middleware, global ReplyKeyboard injection
- Purpose: All Google Sheets reads/writes
- Location: `Telegram Bot/src/sheetsClient.ts`, `Telegram Bot/src/access.ts`
- Depends on: `google-spreadsheet`, `google-auth-library` (JWT service account)
- Used by: All handlers
- Purpose: User-facing command and message handlers
- Location: `Telegram Bot/src/handlers/`
- Contains: `wizard.ts` (entry conversation), `dds.ts`, `balance.ts`, `stats.ts`, `onboarding.ts`, `access-panel.ts`, `reminder.ts`
- Depends on: sheetsClient, shared utilities
- Purpose: Offline data transformation from multiple sources to `dashboard-data.json`
- Location: `etl/`
- Contains: `merge_build.py` (orchestrator), `finance_dds.py`, `sales_from_sheet.py`, `marketing_*.py`, `two_gis_connections.py`
## Data Flow
### Dashboard: Initial Load
### Dashboard: Navigation
### Bot: Record Transaction (Happy Path)
### Bot: Access Request Flow
### ETL: Data Refresh
- Dashboard: no reactive state. Each navigation re-renders from globals. Editable user plans stored in `localStorage` under `dc-*` keys (scenario-engine, goals, etc.).
- Bot: session stored in memory (in-process, resets on restart) via grammY `session()`. Access list cached in module variable with TTL (`access.ts:46`).
## Key Abstractions
- Purpose: Cross-module communication in no-bundler environment
- Pattern: each JS file is an IIFE that registers `window.SomeName = { ... }` before returning
- Examples: `window.DC.fmt` (formatters), `window.DashboardData` (JSON payload), `window.DaraCostModel` (cost model API), `window.FinanceDashboard`, `window.HeatmapDashboard`
- Purpose: Typed grammY context with session + conversations flavor
- Location: `Telegram Bot/src/types.ts`
- Pattern: `type BotContext = ConversationFlavor<Context & SessionFlavor<SessionData>>`
- Purpose: Prevent Chart.js memory leaks on re-render
- Pattern: Each render module keeps a local `charts` array/object; calls `.destroy()` before recreating
- Example: `dashboard/js/finance-dashboard.js:13-17`, `dashboard/js/sales-dashboard.js:12-15`
## Entry Points
- Location: `dashboard/index.html` + `dashboard/js/main.js`
- Triggers: Browser open (file:// or local http server)
- Responsibilities: Load JSON data, register all routes, start router
- Location: `Telegram Bot/src/index.ts`
- Triggers: `node dist/index.js` (Railway deployment)
- Responsibilities: Create bot, register middleware and handlers, start long polling
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
### Hardcoded Financial Data in JS
## Error Handling
- Bot: global `bot.catch()` handler replies with error text to user (`index.ts:246`). Individual handlers do not have try/catch — errors bubble to global handler.
- Dashboard: render functions check for missing globals (`if (!CM) { console.error(...); return }`). No user-visible error state beyond loading indicators.
- ETL: Python scripts use standard exceptions; no retry logic. Preflight checks available via `preflight_sources.py`.
- Bot silently ignores admin notification failures with `try { } catch { /* ignore */ }` (`index.ts:128`)
- Dashboard render functions return early without user feedback when data is unavailable
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
