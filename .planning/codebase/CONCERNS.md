# Codebase Concerns

**Analysis Date:** 2026-05-13

---

## Security Considerations

**Service account JSON credential file on disk (CRITICAL):**
- Risk: `Telegram Bot/operating-rush-492607-f3-ccd922a38756.json` is a Google service account private key sitting on disk next to the source code.
- Files: `Telegram Bot/operating-rush-492607-f3-ccd922a38756.json`
- Current mitigation: File is NOT in `.gitignore` of the root repo. The Telegram Bot's own `.gitignore` (`Telegram Bot/.gitignore`) does not list this file either. However, `git ls-files` shows it is not currently tracked — meaning it may have been manually excluded or never staged. One accidental `git add .` will commit it.
- Recommendations: Add `operating-rush-492607-f3-ccd922a38756.json` (or `*.json` with exclusions) to `Telegram Bot/.gitignore` immediately. Rotate the key if any doubt exists. Use environment variables or a secrets manager instead.

**2GIS map API key hardcoded in JS (PUBLIC-FACING):**
- Risk: `MAP_KEY = 'ba9c5d28-9cb8-4c35-8eb3-9023496ba786'` is committed to the repository in plain text.
- Files: `dashboard/js/heatmap-dashboard.js:4`
- Current mitigation: None. The dashboard is static HTML — there is no server-side rendering to hide it. This key is visible to anyone who opens DevTools.
- Recommendations: Accept this risk for an internal-use SPA, or use a 2GIS referrer restriction in the 2GIS console to limit the key to specific origins.

**No authentication on dashboard:**
- Risk: `dashboard/index.html` has zero authentication. Anyone who can reach the URL (or the file path) has full read access to all business financial data.
- Files: `dashboard/index.html`, `dashboard/data/dashboard-data.json`
- Current mitigation: Presumably local-only access (opened via `file://` or local `serve`). No deployment infrastructure detected.
- Recommendations: If the dashboard is ever served publicly, add HTTP Basic Auth at the web server level or implement a login gate. For current local use, risk is acceptable.

**Real business financial data committed to git:**
- Risk: `dashboard/data/dashboard-data.json` (464 KB) contains 548 real transactions, 388 marketing spend rows, and cash ledger entries with actual KZT amounts (e.g., `expense: 139784`). Build time is 2026-03-25. Data covers 2025-09-01 through 2026-03-23.
- Files: `dashboard/data/dashboard-data.json`
- Current mitigation: None. File is tracked by git.
- Recommendations: Add `dashboard/data/dashboard-data.json` to `.gitignore`. Rebuild from ETL on each use. If git history needs cleaning, use `git filter-repo`.

**Superadmin username hardcoded in source:**
- Risk: `SUPER_ADMIN_USERNAME = 'Islambek_Sadyrov'` is plaintext in the bot source. If this username changes, a code deploy is required.
- Files: `Telegram Bot/src/access.ts:20`
- Current mitigation: Low severity — username is not a secret, just a config value.
- Recommendations: Move to env var `SUPER_ADMIN_USERNAME` for operational flexibility.

---

## Tech Debt

**Two separate GoogleSpreadsheet instances for same spreadsheet:**
- Issue: `sheetsClient.ts` and `access.ts` each create their own `JWT` + `GoogleSpreadsheet` instance connecting to the same spreadsheet ID. Both call `doc.loadInfo()` independently.
- Files: `Telegram Bot/src/sheetsClient.ts:22-28`, `Telegram Bot/src/access.ts:24-30`
- Impact: Two separate Google Sheets API connections, double quota usage for `loadInfo`, no shared state. If bot scales or Sheets API quota tightens, this doubles the risk of hitting rate limits.
- Fix approach: Extract a shared `getDoc()` singleton into a separate `Telegram Bot/src/googleClient.ts` module and import it in both files.

**Race condition in `ensureLoaded` (sheetsClient.ts):**
- Issue: `ensureLoaded()` checks `if (!docLoaded)` then awaits `doc.loadInfo()`. If two concurrent requests hit this before the first completes, both will call `loadInfo()`. The boolean is set only after the await resolves.
- Files: `Telegram Bot/src/sheetsClient.ts:30-35`
- Impact: Under concurrent bot activity, two parallel `loadInfo()` calls hit Google's API. Usually benign but wastes quota.
- Fix approach: Replace boolean guard with a promise singleton: `let loadPromise: Promise<void> | null = null` and set `loadPromise = doc.loadInfo()` before awaiting it.

**DDS parser relies on fragile regex heuristic:**
- Issue: `getDds()` determines whether a spreadsheet row is a "group" vs "subcategory" using a hardcoded regex: `/^(поставщик|поставщик_1|налоги|хоз\.рас|финансовые операции|маркетинг|транспортные расходы|фот|вывод средств|пополнение|услуги)/i`
- Files: `Telegram Bot/src/sheetsClient.ts:275`
- Impact: If the spreadsheet adds a new top-level category or renames an existing one, it silently falls into subcategory grouping instead of appearing as a section header. The DDS view in the bot will show wrong hierarchy with no error.
- Fix approach: Add an explicit "group marker" column or a named range in the spreadsheet, or derive hierarchy from indentation (cell indent level via `sheet.getCell(r, 0).effectiveFormat.textFormat`).

**DDS row scan hardcoded at 120 rows:**
- Issue: `sheet.loadCells('A1:O120')` and `for (let r = 1; r < 120; r++)` assume the DDS sheet never exceeds 119 data rows.
- Files: `Telegram Bot/src/sheetsClient.ts:212-223`
- Impact: If the ДДС 2026 sheet grows beyond row 120 (more categories or sub-rows), data silently truncates with no warning.
- Fix approach: Use `sheet.rowCount` dynamically: `await sheet.loadCells(`A1:O${sheet.rowCount}`)` and loop up to `sheet.rowCount`.

**`sessionStore.ts` is dead code:**
- Issue: `Telegram Bot/src/sessionStore.ts` exports `getSession` and `resetSession` but zero files import it. The bot uses grammY's built-in `session()` middleware instead.
- Files: `Telegram Bot/src/sessionStore.ts`
- Impact: Maintenance confusion — unclear whether this is intentional or a leftover from an earlier implementation.
- Fix approach: Delete the file.

**`finance-dashboard.js` is 2710 lines — a single-responsibility violation:**
- Issue: The largest JS module in the dashboard handles CFO planning view, 2025 fact view, 2026 plan view, chart rendering, KPI cards, scenario overlays, and table rendering. All in one IIFE.
- Files: `dashboard/js/finance-dashboard.js`
- Impact: High cognitive load when modifying any finance feature. Any change risks unintended side effects across sections. No unit tests cover this file.
- Fix approach: When refactoring, split into at minimum: `finance-2025.js` (fact view), `finance-2026.js` (plan view), and `finance-charts.js` (shared chart helpers).

---

## Performance Bottlenecks

**Every bot command fetches the full `Ежедневно` sheet:**
- Problem: `listEntries()`, `monthStats()`, `getAccountBalances()`, `getFinancialHealth()`, and `hasTodayEntries()` all call `sheet.getRows()` which loads all rows. As the ledger grows (currently unknown size), every button press re-fetches the entire sheet.
- Files: `Telegram Bot/src/sheetsClient.ts:145, 170, 302, 351, 447`
- Cause: No row caching for the `Ежедневно` sheet. The `access.ts` module has a 30-second TTL cache for the `Доступ` sheet, but `sheetsClient.ts` has no equivalent.
- Improvement path: Add a TTL cache (e.g. 60 seconds) for `Ежедневно` rows. Invalidate on `addEntry()`. This would convert most button presses from a Google Sheets API call to a local memory read.

**`addEntry()` reads the entire column A to find last row:**
- Problem: `sheet.getCellsInRange(`A1:A${sheet.rowCount}`)` on every write to find the last occupied row. For a ledger with 1000+ rows this sends a full column range request.
- Files: `Telegram Bot/src/sheetsClient.ts:100`
- Cause: Google Sheets API doesn't expose a "last row" directly. The implementation reads all of column A.
- Improvement path: Cache row count alongside the row cache. On cache miss, load all rows (already needed for reads) and note the count.

**Dashboard static JSON is 464 KB, loaded on every page open:**
- Problem: `dashboard/data/dashboard-data.json` is 464 KB, fetched with `cache: 'no-store'` on every dashboard load.
- Files: `dashboard/js/app.js:149-165`
- Cause: `cache: 'no-store'` was set to ensure fresh data, but since data is updated manually (no automation), this defeats browser caching for no practical benefit.
- Improvement path: Switch to `cache: 'default'` and use ETL build timestamps in the filename (e.g. `dashboard-data-20260325.json`) or add a versioned query param set at ETL build time.

---

## Fragile Areas

**ETL pipeline has no automation / scheduling:**
- Files: `etl/merge_build.py`, `etl/RUNBOOK.md`
- Why fragile: Data refresh is a manual multi-step process (section 15 of RUNBOOK.md). As of 2026-05-13, `dashboard-data.json` was built 2026-03-25 — approximately 7 weeks stale. The latest transaction date is 2026-02-28 and latest marketing date is 2026-03-23.
- Safe modification: The ETL scripts themselves are stable. The gap is operational: no cron job, no GitHub Actions, no CI trigger. Data goes stale silently.
- Test coverage: No ETL tests exist for individual scripts (only `validate_payload.py` and `smoke_pivot_finance.py` as post-build checks).

**Reminder scheduler has a timing reliability issue:**
- Files: `Telegram Bot/src/handlers/reminder.ts:42`
- Why fragile: `setInterval(check, 5 * 60 * 1000)` runs every 5 minutes and fires if `hour === 20 && minute >= 30 && minute < 35`. The window is exactly 5 minutes wide. If the Railway container restarts between 20:30 and 20:35 and comes back up at 20:35 or later, the reminder is silently skipped for the day. No retry or missed-reminder detection.
- Safe modification: Change window to `minute >= 28 && minute < 38` to provide buffer, or use `node-cron` for precise scheduling.

**Dashboard relies entirely on `window.*` globals for module communication:**
- Files: `dashboard/js/main.js`, `dashboard/js/app.js`, `dashboard/js/analytics.js`, `dashboard/js/ui.js`, etc.
- Why fragile: Modules communicate via `window.DashboardAnalytics`, `window.DashboardUI`, `window.DaraCostModel`, `window.DC`, etc. Load order in `index.html` determines correctness. Adding a new module or reordering `<script>` tags can cause `undefined is not a function` errors.
- Safe modification: Always add new `<script>` tags after the last dependency. Do not refactor individual files into ES modules without updating all callers.

**DDS year navigation allows arbitrary years:**
- Files: `Telegram Bot/src/handlers/dds.ts:32-34`
- Why fragile: The `◀ {year-1}` / `{year+1} ▶` inline buttons let users navigate to any year. `getDds()` will attempt `sheet.sheetsByTitle['ДДС 1999']` and throw `Лист "ДДС 1999" не найден`. The bot's global `bot.catch()` handler catches this and shows the error message to the user, but it is not graceful.
- Safe modification: Clamp year navigation to known range (e.g. 2025–2026) or handle the missing sheet error specifically in `dds.ts`.

---

## Known Bugs

**`withdrawalInCogs` toggle was not consistently applied (recently fixed):**
- The most recent commit `b90794f` fixes a bug where "Чистый ДДС" did not always subtract withdrawals regardless of the `withdrawalInCogs` toggle state.
- Files: `dashboard/js/finance-dashboard.js:708-716`
- Status: Fixed in last commit. Regression test coverage does not exist for this calculation path.

---

## Test Coverage Gaps

**`finance-dashboard.js` — zero unit tests:**
- What's not tested: All CFO planning calculations, 2025 fact aggregation, 2026 plan rendering, `withdrawalInCogs` logic, scenario overlays.
- Files: `dashboard/js/finance-dashboard.js` (2710 lines)
- Risk: Silent regressions when editing finance calculations. The recent `withdrawalInCogs` bug is an example of a calculation error that slipped through.
- Priority: High

**Telegram Bot handlers — no unit or integration tests:**
- What's not tested: `sheetsClient.ts` data transformations, `access.ts` approval flow, `dds.ts` section rendering, `reminder.ts` send logic.
- Files: `Telegram Bot/src/` (all handler files)
- Risk: Any refactor of bot business logic risks breaking real users without detection.
- Priority: Medium

**ETL scripts — no automated tests:**
- What's not tested: `merge_build.py`, `finance_workbook.py`, `sales_from_sheet.py` parsers.
- Files: `etl/*.py`
- Risk: A structural change to source Excel files silently produces corrupted `dashboard-data.json`. Current validation (`validate_payload.py`) only checks schema, not business-rule correctness.
- Priority: Medium

**`cost-model.js` hardcoded constants:**
- What's not tested: Constants like `totalCogs: 95_878_810` in `dashboard/js/cost-model.js:20` are plan-year figures that will become incorrect in 2027 without a systematic update mechanism.
- Files: `dashboard/js/cost-model.js`
- Risk: Dashboard shows outdated unit economics silently.
- Priority: Low

---

## Dependencies at Risk

**`xlsx` package (SheetJS) version 0.18.5:**
- Risk: `dashboard/package.json` pins `xlsx: "^0.18.5"`. SheetJS moved its community edition to a different package structure at v0.19+. The CDN URL in `index.html` explicitly pins `xlsx-0.20.2`. There is a version mismatch between the CDN load and the npm devDependency used in ETL.
- Files: `dashboard/index.html:13`, `dashboard/package.json`
- Impact: If the CDN load is updated separately from the npm dep, behavior may differ.
- Migration plan: Align both to same version or document the intentional split.

**No `requirements.txt` lock / `pip freeze`:**
- Risk: `etl/requirements.txt` lists `openpyxl>=3.1.0`, `pandas>=2.0.0`, `pdfplumber>=0.11.0`, `xlrd>=2.0.1` with lower-bound-only pins. A future `pip install` can pull in a breaking major version.
- Files: `etl/requirements.txt`
- Impact: ETL breaks silently on a new machine or CI environment.
- Migration plan: Add `requirements-lock.txt` via `pip freeze > requirements-lock.txt` and use it for installs.

---

## Missing Critical Features

**No ETL automation:**
- Problem: Dashboard data goes stale without a scheduled pipeline. Current state: data is 7+ weeks old (built 2026-03-25, today 2026-05-13).
- Blocks: Real-time business decisions based on dashboard; the bot and dashboard can show contradictory figures.

**No error alerting from the bot:**
- Problem: `bot.catch()` logs errors to `console.error` and sends the error message to the user, but no Telegram alert goes to the admin/owner and no structured logging (e.g. to a file or external service) exists.
- Files: `Telegram Bot/src/index.ts:246-252`
- Blocks: Silent failures go unnoticed in production (Railway logs are not monitored in real-time).

**No `.env.example` for the Telegram Bot:**
- Problem: No documented template of required environment variables exists. A new developer or a fresh Railway deploy has no reference for what `BOT_TOKEN`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `TZ` must be set to.
- Files: `Telegram Bot/` (missing `.env.example`)
- Blocks: Onboarding new contributors or recovering from a Railway project reset.

---

*Concerns audit: 2026-05-13*
