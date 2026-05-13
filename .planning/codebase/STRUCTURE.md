# Codebase Structure

**Analysis Date:** 2026-05-13

## Directory Layout

```
Dara Clean/                         # Repo root
├── dashboard/                      # Vanilla JS SPA — financial dashboard
│   ├── index.html                  # Single HTML file — app shell + all page slots
│   ├── css/
│   │   ├── theme-light.css         # CSS variables, base tokens (colors, typography)
│   │   ├── finance.css             # Layout, components, page-specific styles
│   │   └── dashboard.css           # Legacy dashboard styles
│   ├── js/
│   │   ├── main.js                 # Bootstrap: data load, route registration, init
│   │   ├── router.js               # Hash router — navigate(), on(), refresh()
│   │   ├── finance-dashboard.js    # Finance views: overview, 2025, 2026, cost
│   │   ├── finance-data.js         # Hardcoded monthly fact/plan data (2025–2026)
│   │   ├── cost-model.js           # COGS model, break-even, CAC/LTV, channels
│   │   ├── scenario-engine.js      # CFO planning scenarios (localStorage-persisted)
│   │   ├── sales-dashboard.js      # Sales views: managers, channels, clients, plan
│   │   ├── sales-funnel.js         # Funnel data engine
│   │   ├── sales-funnel-ui.js      # Funnel UI helpers
│   │   ├── funnel-analytics.js     # Cross-channel funnel with month selector
│   │   ├── unit-economics.js       # CAC/LTV, marketing efficiency, growth model
│   │   ├── heatmap-dashboard.js    # Geographic client heatmap via 2GIS MapGL
│   │   ├── analytics.js            # Shared analytics utilities
│   │   ├── ui.js                   # UI utilities, shared HTML helpers
│   │   ├── demo-data.js            # Demo data generator (fallback when no JSON)
│   │   └── editable-table.js       # Editable table component (minimal)
│   ├── data/
│   │   ├── dashboard-data.json     # ETL output — main data payload (464 KB)
│   │   ├── geocoded-addresses.json # Client addresses with lat/lng (1.1 MB)
│   │   ├── almaty-districts.json   # GeoJSON district boundaries (100 KB)
│   │   ├── sample-data.json        # Static sample/demo data
│   │   └── templates/
│   │       ├── finance_daily_plan_template.csv
│   │       └── sales_import_template.csv
│   ├── tests/
│   │   └── e2e/                    # Playwright E2E tests
│   ├── package.json                # Dev deps: Playwright only
│   └── playwright.config.mjs
│
├── Telegram Bot/                   # Node.js/TypeScript bot (grammY)
│   ├── src/
│   │   ├── index.ts                # Bot entry point: init, middleware, commands
│   │   ├── sheetsClient.ts         # Google Sheets CRUD — all sheet operations
│   │   ├── access.ts               # Access control via "Доступ" sheet
│   │   ├── dict.ts                 # Dictionary cache (getDict, invalidateDict)
│   │   ├── calendar.ts             # Inline calendar component (day/month/year picker)
│   │   ├── env.ts                  # Env var schema (zod)
│   │   ├── types.ts                # BotContext, SessionData, DraftEntry types
│   │   ├── shared.ts               # Common helpers: sendMainMenu, withLoading, deletePrev
│   │   ├── ui.ts                   # formatMoney, parseAmount
│   │   └── handlers/
│   │       ├── wizard.ts           # addEntryConversation (7-step transaction wizard)
│   │       ├── dds.ts              # DDS (cash flow) view with month/quarter drill-down
│   │       ├── balance.ts          # Account balances + financial position
│   │       ├── stats.ts            # Last entries + monthly stats
│   │       ├── onboarding.ts       # New user onboarding steps
│   │       ├── access-panel.ts     # Admin access management panel
│   │       └── reminder.ts         # Evening reminder scheduler (20:30 Almaty)
│   ├── apps-script/
│   │   ├── Code.gs                 # Google Apps Script (legacy webhook approach)
│   │   ├── Api.gs
│   │   └── TelegramWebhookBot.gs
│   ├── dist/                       # TypeScript compiled output (gitignored)
│   ├── package.json                # grammY, google-spreadsheet, zod
│   └── tsconfig.json
│
├── etl/                            # Python ETL pipeline
│   ├── merge_build.py              # Main assembler — runs all sources → dashboard-data.json
│   ├── finance_dds.py              # DDS Excel reader and structurer
│   ├── finance_workbook.py         # Finance workbook parser
│   ├── sales_from_sheet.py         # Sales Excel → transaction records
│   ├── marketing_google_timeseries.py   # Google Ads CSV parser
│   ├── marketing_yandex_metrica.py      # Yandex Metrica CSV parser
│   ├── yandex_metrica_bundle.py         # Yandex bundle aggregator
│   ├── two_gis_connections.py      # 2GIS XLSX parser
│   ├── two_gis_consolidate.py      # 2GIS data consolidator
│   ├── fx_usd_kzt.py               # USD→KZT rate loader
│   ├── fetch_nbrk_rates.py         # NBRK exchange rates fetcher
│   ├── generate_sales_templates.py # Sales template generator
│   ├── validate_payload.py         # JSON output validator
│   ├── preflight_sources.py        # Pre-run source file checks
│   ├── io_utils.py                 # File I/O utilities
│   ├── date_parse.py               # Date parsing utilities
│   ├── parse_kzt.py                # KZT amount parsing
│   ├── excel_dates.py              # Excel date serial number conversion
│   ├── RUNBOOK.md                  # Full pipeline runbook with examples
│   ├── DATA_SOURCES.md             # Source file mapping documentation
│   ├── requirements.txt
│   └── data/                       # ETL intermediate data files
│
├── scripts/                        # Utility scripts (run ad-hoc)
│   ├── build_charts.py             # Chart data builder
│   ├── build_cost_table.py         # Cost table builder for Excel
│   ├── build_dds_v2.py             # DDS builder v2
│   ├── build_dds_2026_v2.py        # 2026 DDS builder
│   ├── build_planning_sheets.py    # Planning sheet builder
│   ├── fix_dds_2026_formulas.py    # Formula fixer for DDS 2026
│   ├── fix_dds_final.py
│   ├── geocode.js                  # Address geocoder (original)
│   ├── geocode-2gis.js             # 2GIS geocoder
│   ├── geocode-2gis-v2.js          # 2GIS geocoder v2 (current)
│   ├── geocode-api.js              # Generic geocode API wrapper
│   ├── geocode-test.js             # Geocoder test script
│   └── modify_excel.py             # Excel file modifier utility
│
├── crm/                            # CRM prototype (currently empty)
│   ├── css/
│   ├── data/
│   ├── js/
│   └── scripts/
│
├── Данные/                         # Raw source data files (Excel, HTML)
│   ├── ДДС 2026.xlsx
│   ├── Структура расходов по блокам.xlsx
│   ├── Тепловая карта.xlsx
│   ├── июль - декабрь 2025 *.xlsx
│   ├── январь - апрель сумма и дата.xlsx
│   └── Клиентская база/
│
├── Консультация/                   # Separate consultation sub-project (own .git)
│
├── index.html                      # Root redirect/alias to dashboard (legacy)
├── DaraClean_Dashboard_v2.html     # Standalone legacy dashboard HTML
├── PROMPT-01-DATA-CONTEXT.md       # Business context prompts
├── PROMPT-02-COST-UNIT-ECONOMICS.md
├── PROMPT-03-FINANCIAL-PLAN.md
├── PROMPT-04-SALES-FUNNEL.md
├── PROMPT-05-DASHBOARD-UI.md
├── PROMPT-FINANCIAL-DASHBOARD.md
├── logs/                           # Log files
├── node_modules/                   # Root-level node_modules (Playwright etc.)
└── .planning/                      # GSD planning artifacts
    └── codebase/                   # Codebase map documents
```

## Directory Purposes

**`dashboard/js/`:**
- Purpose: All SPA application logic
- Contains: Router, render modules, data models, business logic
- Key files: `main.js` (bootstrap), `router.js` (navigation), `finance-dashboard.js` (largest module at 144 KB)

**`dashboard/data/`:**
- Purpose: Static JSON data consumed by the SPA at runtime
- Contains: ETL-generated JSON + static GeoJSON
- Key files: `dashboard-data.json` (primary data payload, rebuilt by ETL)

**`Telegram Bot/src/`:**
- Purpose: All bot source code
- Contains: Entry point, handlers, data access, utilities
- Key files: `index.ts` (bot wiring), `sheetsClient.ts` (all Sheets I/O)

**`Telegram Bot/src/handlers/`:**
- Purpose: Feature-specific message handlers and conversations
- Contains: One file per major feature area
- Key files: `wizard.ts` (transaction entry), `dds.ts` (cash flow)

**`etl/`:**
- Purpose: Offline data pipeline from raw exports to dashboard JSON
- Contains: Python scripts + RUNBOOK documentation
- Key files: `merge_build.py` (main entry), `RUNBOOK.md` (operational guide)

**`scripts/`:**
- Purpose: Ad-hoc utility scripts for data maintenance and Excel manipulation
- Contains: Python scripts for DDS/chart building, JS scripts for geocoding

## Key File Locations

**Entry Points:**
- `dashboard/index.html`: Dashboard app shell — defines page slots and script load order
- `dashboard/js/main.js`: Bootstrap — JSON load, route registration, `DOMContentLoaded`
- `Telegram Bot/src/index.ts`: Bot entry — `new Bot()`, middleware stack, `bot.start()`
- `etl/merge_build.py`: ETL entry — CLI args parse, source loads, JSON output

**Configuration:**
- `Telegram Bot/src/env.ts`: Env var schema (zod). Required: `BOT_TOKEN`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `TZ`
- `Telegram Bot/tsconfig.json`: TypeScript config (ESM output)
- `dashboard/playwright.config.mjs`: E2E test config

**Core Logic:**
- `dashboard/js/finance-data.js`: Source of hardcoded 2025 fact / 2026 plan monthly arrays
- `dashboard/js/cost-model.js`: COGS block model, CAC, break-even calculations → `window.DaraCostModel`
- `dashboard/js/scenario-engine.js`: CFO planning with localStorage persistence → `window.ScenarioEngine`
- `Telegram Bot/src/sheetsClient.ts`: All Google Sheets operations — the only layer that touches the spreadsheet from the bot
- `etl/RUNBOOK.md`: Authoritative guide to rebuild `dashboard-data.json`

**Testing:**
- `dashboard/tests/e2e/`: Playwright specs for dashboard
- `dashboard/test-results/`: Playwright test output

## Naming Conventions

**Files:**
- Dashboard JS: `kebab-case.js` — each file is one feature module or layer
- Bot handlers: `kebab-case.ts` in `handlers/` — one file per bot feature
- Bot core: `camelCase.ts` at `src/` level — e.g., `sheetsClient.ts`, `sessionStore.ts`
- ETL scripts: `snake_case.py` — e.g., `merge_build.py`, `finance_dds.py`
- Geocoder scripts: `kebab-case.js` — e.g., `geocode-2gis-v2.js`

**Directories:**
- Feature grouping by runtime: `dashboard/`, `Telegram Bot/`, `etl/`, `scripts/`
- Russian names for data directories: `Данные/`, `Консультация/`

**JS Modules (Dashboard):**
- Each module uses IIFE pattern: `;(function (global) { ... })(window)`
- Registers global as `window.FeatureName` (PascalCase): `window.FinanceDashboard`, `window.DaraCostModel`
- Shared formatter: `window.DC.fmt` (set by `main.js`)

**Bot TypeScript:**
- Named exports for registration functions: `registerDds(bot)`, `registerBalance(bot)`
- Named exports for individual handlers: `handleLast(ctx)`, `handleStats(ctx)`
- Types: PascalCase interfaces/types in `types.ts`

## Where to Add New Code

**New Dashboard Page/View:**
1. Add `<div id="page-newfeature" class="page">` slot in `dashboard/index.html`
2. Add route entry to `ROUTES` map in `dashboard/js/router.js`
3. Create `dashboard/js/newfeature.js` as IIFE, register `window.NewFeature = { render }`
4. Add `<script src="js/newfeature.js">` to `dashboard/index.html` before `main.js`
5. Register route handler in `dashboard/js/main.js`: `Router.on('#newfeature', () => window.NewFeature.render())`

**New Bot Command or Button:**
1. Create `Telegram Bot/src/handlers/newfeature.ts` with `export const registerNewFeature = (bot) => { ... }`
2. Import and call `registerNewFeature(bot)` in `Telegram Bot/src/index.ts`
3. If it needs Sheets data, add the query function to `Telegram Bot/src/sheetsClient.ts`

**New ETL Data Source:**
1. Create parser in `etl/newparser.py`
2. Import and call in `etl/merge_build.py`, merge result into output JSON
3. Add CLI argument to `merge_build.py` argument parser
4. Document the new source in `etl/DATA_SOURCES.md`

**New Utility Script:**
- One-off data manipulation → `scripts/`
- Reusable ETL building block → `etl/`

## Special Directories

**`dashboard/data/`:**
- Purpose: Runtime data for SPA
- Generated: `dashboard-data.json` and `geocoded-addresses.json` are ETL outputs. `almaty-districts.json` is static GeoJSON. `sample-data.json` is static.
- Committed: Yes (JSON files are committed; large files like `geocoded-addresses.json` at 1.1 MB)

**`Telegram Bot/dist/`:**
- Purpose: TypeScript compiled output
- Generated: Yes (by `tsc`)
- Committed: No (in `.gitignore`)

**`Telegram Bot/apps-script/`:**
- Purpose: Google Apps Script files (legacy webhook approach, superseded by long-polling bot)
- Generated: No
- Committed: Yes

**`Консультация/`:**
- Purpose: Separate consultation project with own `.git` repo
- Generated: No
- Committed: Separate git history

**`crm/`:**
- Purpose: CRM prototype — currently empty skeleton (css/, data/, js/, scripts/ subdirs with no files)
- Status: Placeholder, not implemented

**`Данные/`:**
- Purpose: Raw source data files used as ETL inputs (Excel workbooks, HTML exports)
- Generated: No — produced externally (accounting software, 2GIS exports)
- Committed: Yes (Excel files committed to git)

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents for agent context
- Generated: Yes (by `/gsd-map-codebase`)
- Committed: Yes

---

*Structure analysis: 2026-05-13*
