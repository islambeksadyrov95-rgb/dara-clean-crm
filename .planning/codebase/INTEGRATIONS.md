# External Integrations

**Analysis Date:** 2026-05-13

## APIs & External Services

**Telegram Bot API:**
- Used for: the entire Telegram bot interface (messages, keyboards, conversations)
- SDK/Client: `grammy` 1.23.1 (`Telegram Bot/src/index.ts`)
- Auth: `BOT_TOKEN` env var
- Transport: long polling (not webhook), hosted on Railway
- No webhook endpoint exposed

**2GIS API (geocoding):**
- Used for: geocoding carpet-cleaning client addresses to lat/lng for heatmap
- Client: direct HTTPS requests (`scripts/geocode-api.js`, `scripts/geocode-2gis.js`, `scripts/geocode-2gis-v2.js`)
- Auth: public MapGL key `ba9c5d28-9cb8-4c35-8eb3-9023496ba786` (hardcoded in scripts)
- Bounding box: Almaty region (lat 43.05–43.55, lng 76.60–77.40)
- Output: `dashboard/data/geocoded-addresses.json`

**National Bank of Kazakhstan (NBRK) FX rates:**
- Used for: USD/KZT conversion in ETL pipeline
- Client: `urllib.request` scraping `nationalbank.kz/rss/get_rates.cfm` (`etl/fetch_nbrk_rates.py`)
- No auth required
- Output: `etl/data/nbrk_usd_kzt.json`

**Yandex.Metrica:**
- Used for: marketing channel analytics (clicks/sessions) fed into ETL
- Client: CSV export parsing (`etl/yandex_metrica_bundle.py`, `etl/marketing_yandex_metrica.py`)
- Input: CSV files placed in `маркетинг/Яндекс/` directory

**Google Ads:**
- Used for: marketing spend data fed into ETL
- Client: CSV export parsing (`etl/marketing_google_timeseries.py`)
- Input: CSV files placed in `маркетинг/Google/` directory

## Data Storage

**Databases:**
- None — no relational database in any component

**Google Sheets (primary data store for bot):**
- Spreadsheet ID: `1s69C6KuskSfajoOVnqiwUcv2TLZqzgCr9CyW4-aKqf4`
- Connection: `GOOGLE_SPREADSHEET_ID` env var
- Client: `google-spreadsheet` 5.2.0 + `google-auth-library` 10.6.2 JWT
- Auth: GCP service account — `dara-clean-bot@operating-rush-492607-f3.iam.gserviceaccount.com`
- Key sheets accessed by bot:
  - `Ежедневно` — all financial transactions (date, type, payment, amount, category, article, comment)
  - `Справочник` — reference data (operation types, payment types, categories, articles, employees)
  - `ДДС 2025` / `ДДС 2026` — cash flow statements by month (hierarchical rows, months in columns B–M)
  - `Доступ` — bot user access control (chatId, username, role, status, inviteCode)
  - `Лимиты` — fund budgets (year, month, plan, actual, remaining)
- Write pattern: `sheet.loadCells()` + `getCellByA1()` + `saveUpdatedCells()`, `valueInputOption: USER_ENTERED`
- Implementation: `Telegram Bot/src/sheetsClient.ts`

**Google Sheets (Apps Script alternative path):**
- Apps Script web app deployed from `Telegram Bot/apps-script/Code.gs`
- API key auth (`CONFIG.apiKey`, set in Script Properties)
- Writes to sheets: `Справочник` (dict) and `Ежедневно` (entries)
- Secondary path — bot currently uses direct Sheets SDK, not Apps Script HTTP

**File Storage:**
- Local filesystem only for dashboard and ETL
- Dashboard data: `dashboard/data/dashboard-data.json`, `dashboard/data/geocoded-addresses.json`
- ETL outputs: `etl/data/nbrk_usd_kzt.json`, `etl/inventory_report.json`
- Source Excel/CSV files: `Данные/` directory (raw data from business)

**Caching:**
- In-memory only — Telegram Bot caches reference data (dictionary) in a module-level variable
- Cache invalidation: explicit user action ("🔄 Обновить справочники") calls `invalidateDict()` (`Telegram Bot/src/dict.ts`)
- Session state: `Map<chatId, SessionData>` in `Telegram Bot/src/sessionStore.ts` (in-memory, lost on restart)

## Authentication & Identity

**Telegram Bot Access Control:**
- Custom implementation — no external auth provider
- Access list stored in Google Sheets `Доступ` sheet
- Superadmin: `@Islambek_Sadyrov` (hardcoded, cannot be removed)
- All approved users are admins (can manage others)
- Three access paths: `/start` request → manual approval, add by @username, invite link
- Implementation: `Telegram Bot/src/access.ts`, `Telegram Bot/src/handlers/access-panel.ts`

**Google Sheets Auth:**
- GCP service account with JWT, scope: `https://www.googleapis.com/auth/spreadsheets`
- Credentials: `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` env vars
- Private key file also present at `Telegram Bot/operating-rush-492607-f3-ccd922a38756.json` (do not commit)

**Dashboard:**
- No authentication — static SPA, open access

## Monitoring & Observability

**Error Tracking:**
- None formally integrated (no Sentry, no Datadog)

**Logs:**
- Railway platform logs (`railway logs`) for bot production output
- Bot uses `console.log` / `console.error` directly
- Reminder scheduled task logs to console (`Telegram Bot/src/handlers/reminder.ts`)

**Telegram as monitoring channel:**
- Evening reminder at 20:30 Asia/Almaty checks if entries were recorded today
- Sends motivational message to all users if no entries found

## CI/CD & Deployment

**Hosting:**
- Telegram Bot: Railway (project "Dara Clean Bot"), long polling
- Dashboard: static files, no fixed hosting — served locally via `npx serve .` on port 3399 or opened as `file://`

**CI Pipeline:**
- None — no GitHub Actions, no automated CI

**Deploy process (Telegram Bot):**
```bash
npx tsc -p tsconfig.json   # compile TypeScript
railway up                  # deploy to Railway
sleep 25 && railway logs   # verify "Bot started successfully"
```

**Environment variables on Railway:**
- Set via `railway variables set KEY="value"`
- Required: `BOT_TOKEN`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `TZ`

## Environment Configuration

**Required env vars (Telegram Bot):**
- `BOT_TOKEN` — Telegram Bot API token
- `GOOGLE_SPREADSHEET_ID` — Google Sheets document ID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email
- `GOOGLE_PRIVATE_KEY` — RSA private key with literal `\n` for newlines
- `TZ` — defaults to `Asia/Almaty` if not set

**Secrets location:**
- Railway environment variables (production)
- `.env` file (local development, not committed)
- Apps Script: Script Properties in Google Apps Script editor

## Webhooks & Callbacks

**Incoming:**
- None — bot uses long polling, no inbound webhook endpoint

**Outgoing (Apps Script alternative):**
- `Telegram Bot/apps-script/TelegramWebhookBot.gs` contains a legacy webhook-mode Google Apps Script bot
- Deployed as Google Apps Script Web App; not the active production path
- Uses `PropertiesService` for `BOT_TOKEN` storage

## Data Pipeline (ETL)

**ETL orchestration** (`etl/merge_build.py`):
- Merges: Google Ads CSVs + 2GIS Excel + Yandex Metrica CSVs + sales Excel + finance Excel
- Output: `dashboard/data/dashboard-data.json` (single data source for dashboard SPA)
- FX conversion: USD→KZT using NBRK rates from `etl/data/nbrk_usd_kzt.json`
- PDF extraction: `pdfplumber` for payment tables (`etl/pdf_payments_by_machine.py`)
- Validation: `etl/validate_payload.py`, golden snapshot at `etl/golden_metrics.example.json`

---

*Integration audit: 2026-05-13*
