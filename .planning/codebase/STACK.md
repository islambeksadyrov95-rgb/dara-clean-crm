# Technology Stack

**Analysis Date:** 2026-05-13

## Languages

**Primary:**
- JavaScript (ES2022) — Dashboard SPA (`dashboard/js/`)
- TypeScript (strict, ESM) — Telegram Bot (`Telegram Bot/src/`)
- Python 3.11 — ETL pipeline (`etl/`)

**Secondary:**
- JavaScript (Apps Script) — Google Sheets backend (`Telegram Bot/apps-script/`)

## Runtime

**Environment:**
- Node.js v24.13.0 (dashboard dev server + Telegram Bot)
- Python 3.11.8 (ETL scripts)

**Package Manager:**
- npm (lockfile: `dashboard/package-lock.json`, `Telegram Bot/package-lock.json`)
- Both lockfiles present

## Frameworks

**Dashboard SPA:**
- No framework — vanilla JS IIFE modules, hash-based router (`dashboard/js/router.js`)
- Chart.js 4.4.6 — charts (CDN: `cdn.jsdelivr.net`)
- SheetJS (xlsx) 0.20.2 — Excel export (CDN: `cdn.sheetjs.com`)

**Telegram Bot:**
- grammY 1.23.1 — Telegram Bot framework (`Telegram Bot/src/index.ts`)
- @grammyjs/conversations 2.1.1 — multi-step wizard flows
- @grammyjs/menu 1.3.1 — inline keyboard menus

**Testing:**
- Playwright 1.59.1 — E2E tests for dashboard (`dashboard/playwright.config.mjs`), Chromium headless
- Custom Node.js test runner — `dashboard/tests/compute.test.mjs`, `dashboard/tests/verify-invariants.mjs`

**Build/Dev:**
- tsc 5.7.3 → `dist/` — Telegram Bot compilation (`Telegram Bot/tsconfig.json`)
- tsx 4.19.2 — dev hot-reload (`tsx watch src/index.ts`)
- npx serve — dashboard dev server on port 3399

## Key Dependencies

**Critical (Telegram Bot):**
- `grammy` 1.23.1 — core bot framework, long polling, session middleware
- `@grammyjs/conversations` 2.1.1 — multi-step entry wizard (`Telegram Bot/src/handlers/wizard.ts`)
- `google-spreadsheet` 5.2.0 — Google Sheets CRUD client
- `google-auth-library` 10.6.2 — JWT service account auth for Sheets API
- `zod` 3.23.8 — env var validation (`Telegram Bot/src/env.ts`) and API response schemas
- `dotenv` 16.4.5 — environment loading

**Critical (Dashboard):**
- Chart.js 4.4.6 — financial/sales charts (loaded via CDN, no npm install)
- xlsx 0.18.5 (npm dev) — Excel generation for plan export
- SheetJS 0.20.2 (CDN) — client-side Excel in browser

**ETL (Python):**
- `openpyxl>=3.1.0` — Excel read/write (`etl/requirements.txt`)
- `pandas>=2.0.0` — data transformation
- `pdfplumber>=0.11.0` — PDF table extraction
- `xlrd>=2.0.1` — legacy Excel format reading

**DevDependencies (Telegram Bot):**
- `typescript` 5.7.3
- `eslint` 9.20.1 + `@typescript-eslint/*`
- `prettier` 3.4.2

## Configuration

**Environment (Telegram Bot):**
- `BOT_TOKEN` — Telegram Bot API token
- `GOOGLE_SPREADSHEET_ID` — target Google Sheet ID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — GCP service account email
- `GOOGLE_PRIVATE_KEY` — RSA private key (with `\n` escaping)
- `TZ` — timezone, default `Asia/Almaty`
- Validated at startup via Zod (`Telegram Bot/src/env.ts`)

**TypeScript Config (`Telegram Bot/tsconfig.json`):**
- `target: ES2022`, `module: ES2022`, `moduleResolution: Bundler`
- `strict: true`, `sourceMap: true`
- Output: `dist/`, source: `src/`

**Playwright Config (`dashboard/playwright.config.mjs`):**
- testDir: `./tests/e2e`
- Viewport: 1440×900
- Web server: `npx serve . -l 3399`
- Screenshots on failure only

## Platform Requirements

**Development:**
- Node.js v24+ (confirmed in environment)
- Python 3.11+
- Windows 10 + Git Bash (project runs on Windows, Unix paths used in scripts)

**Production:**
- Telegram Bot: Railway (long polling, not webhook)
- Dashboard: static file server (serve, Vercel, or `file://` local open)
- Bot timezone: `Asia/Almaty` (UTC+5, Almaty, Kazakhstan)

---

*Stack analysis: 2026-05-13*
