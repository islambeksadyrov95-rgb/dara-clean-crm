# Coding Conventions

**Analysis Date:** 2026-05-13

## Two Codebases, Two Styles

This repo has two distinct sub-projects with different conventions. Always identify which you're working in before writing code.

- **`dashboard/`** — vanilla JS, no build step, IIFE modules, no linter configured
- **`Telegram Bot/src/`** — TypeScript ESM, compiled via `tsc`, ESLint + Prettier configured

---

## dashboard/ — Vanilla JS Conventions

### Module Pattern

Every file is an IIFE that receives `window` (or `global`) as parameter and attaches exports to it:

```js
;(function (global) {
  'use strict'

  // ... implementation ...

  global.MyModule = { fn1, fn2 }
})(window)
```

The leading semicolon prevents concatenation issues. `'use strict'` is always present.

Files that only wrap one module may use `window` directly:

```js
;(function () {
  'use strict'
  // ...
  window.DC = window.DC || {}
  window.DC.fmt = { money, num, pct }
})()
```

### Naming Patterns

**Files:** `kebab-case.js` (e.g., `finance-dashboard.js`, `sales-funnel-ui.js`)

**Functions:** `camelCase`, verbs preferred — `renderCost`, `applyFilters`, `buildMonthlyData`, `detectDistrict`

**Variables:** `camelCase` for locals, `SCREAMING_SNAKE_CASE` for module-level constants

```js
const MS_DAY = 86400000
const ALMATY_CENTER = [76.889709, 43.238293]
const STORAGE_KEY = 'dc-finplan'
```

**Private helpers:** underscore prefix for internal-only functions

```js
function _norm(s) { ... }         // Python ETL
const _parseRowNumeric = ...       // Python ETL
```

(In JS files, no underscore prefix — all helpers are just const functions in IIFE scope.)

**DOM helpers:** short aliases at top of IIFE, always `const el = id => document.getElementById(id)` or `const qs = sel => document.querySelector(sel)`

### Code Style

**Formatting:**
- 2-space indentation throughout
- Single quotes for strings
- No trailing semicolons on statements (Prettier-style — but no Prettier configured, enforced manually)
- Arrow functions for short helpers: `const sum = (arr, pick) => arr.reduce((s, x) => s + pick(x), 0)`
- Regular `function` declarations for named render functions

**Line length:** not enforced, long lines acceptable for data arrays

**Object/array style:**
```js
// Aligned columns in data arrays — common pattern
{ id: 'google',   label: 'Google Ads',       budgetMonth: 685_378, inquiries: 261 },
{ id: '2gis',     label: '2ГИС',             budgetMonth: 304_152, inquiries: 226 },
```

**Numeric literals:** underscore separators for large numbers: `113_205_924`, `66_700_000`

**Section separators:** `// ─── SECTION NAME ───────────────────────────────────` (box-drawing chars)

### Import Organization (dashboard)

No imports — all modules loaded via `<script>` tags in `index.html`. Modules access each other through globals:

```js
const CM = global.DaraCostModel   // access other module
const FD = global.DaraFinanceData
```

Always guard globals before use:
```js
if (!CM) { console.error('DaraCostModel not loaded'); return }
```

### Formatting Utilities

A shared formatting namespace `window.DC.fmt` is set by `main.js`. Modules reference it with a local lazy getter:

```js
const fmt = () => global.DC && global.DC.fmt
  ? global.DC.fmt
  : {
      money: n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' ₸',
      num:   n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0),
      pct:   (n, d) => (n || 0).toFixed(d != null ? d : 1) + '%'
    }
```

Never hardcode number formatting inline — always use `fmt().money(n)`, `fmt().num(n)`, `fmt().pct(n)`.

### Error Handling (dashboard)

- `console.error(message)` for missing module dependencies
- `try { ... } catch (e) { console.error(..., e) }` for render functions called by Router
- `try { ... } catch { /* ignore */ }` for cleanup (chart destroy, localStorage)
- `console.warn(...)` for non-critical async failures (e.g., data loading)
- No user-facing error UI — pages silently render empty on failure

```js
try { handlers[hash]() } catch (e) { console.error('Router handler error:', hash, e) }
```

### Chart Management

Every module that uses Chart.js maintains its own registry array and destroys charts before re-render:

```js
let costCharts = []
const destroyCostCharts = () => {
  costCharts.forEach(c => { try { c.destroy() } catch (e) { /**/ } })
  costCharts = []
}
const makeChart = (ctx, cfg) => {
  const c = new Chart(ctx, cfg)
  costCharts.push(c)
  return c
}
```

### Comments

- Business logic comments in Russian: `// Доля маркетинга в COGS (факт 2025)`
- Source attribution always present: `// Источник: Excel «Для анализа.xlsx»`
- Section headers use box-drawing dividers
- Data derivation formulas documented inline:

```js
// Расчёт: Выручка (113M ₸) / Средняя цена за кв.м. (~1,000 ₸) = 101,000 кв.м.
```

---

## Telegram Bot/src/ — TypeScript Conventions

### Naming Patterns

**Files:** `camelCase.ts` for modules (`sheetsClient.ts`, `sessionStore.ts`), `kebab-case.ts` for handlers (`access-panel.ts`, `wizard.ts`)

**Functions:** `camelCase` exported functions, `camelCase` for internal helpers

**Types:** `PascalCase` — `BotContext`, `SessionData`, `DraftEntry`, `EntryRow`, `Dictionary`

**Constants:** `SCREAMING_SNAKE_CASE` for module-level — `MONTHS_FULL`, `MONTHS_SHORT`, `SEP`, `STEPS`, `ONBOARDING_STEPS`

### Code Style

**Formatting:** Prettier configured (`prettier . --write`), settings not in a config file (uses defaults)

**TypeScript:** `strict: true` in tsconfig — no `any` without explicit reason

**Module system:** ESM with `.js` extensions in imports (required for Node ESM):

```ts
import { env } from './env.js'
import type { BotContext } from './types.js'
```

**Type imports:** separate `import type` for type-only imports

**Async/await:** all async code uses `await`, no `.then()` chains

### Environment Variables

All env vars go through `src/env.ts` via Zod validation. Never access `process.env` directly elsewhere:

```ts
// env.ts
const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  GOOGLE_SPREADSHEET_ID: z.string().min(1),
  TZ: z.string().min(1).default('Asia/Almaty')
})
export const env = envSchema.parse(process.env)
```

### Error Handling (Telegram Bot)

- `try { ... } catch { /* ignore */ }` for best-effort cleanup (delete message)
- Throw `Error` with Russian message for domain errors: `throw new Error('Лист "X" не найден')`
- No global error boundary — grammY handles uncaught errors per update

### Import Organization (Telegram Bot)

1. External packages (`grammy`, `zod`, etc.)
2. Blank line
3. Internal modules (relative `./` or `../` imports)
4. Blank line
5. `import type` statements

---

## ETL (etl/) — Python Conventions

**Style:** PEP 8, type hints (`from typing import ...`), docstrings in Russian

**Functions:** `snake_case`, private with leading underscore (`_norm`, `_parse_row_numeric`)

**Constants:** `SCREAMING_SNAKE_CASE`

**Encoding declaration:** `# -*- coding: utf-8 -*-` at top of each file

---

## Shared Conventions (Both JS and TS)

- Month arrays always defined as `MONTHS_SHORT` (3-letter) and `MONTHS_FULL` (full Russian names)
- Russian locale formatting via `Intl.NumberFormat('ru-RU', ...)` — never manual string formatting
- Date handling: ISO 8601 strings (`YYYY-MM-DD`) for data, `DD.MM.YYYY` only for Google Sheets display

---

*Convention analysis: 2026-05-13*
