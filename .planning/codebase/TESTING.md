# Testing Patterns

**Analysis Date:** 2026-05-13

## Overview

Two test types exist in `dashboard/`. The `Telegram Bot/` has no tests. ETL has no tests.

| Type | Runner | Location | Purpose |
|------|--------|----------|---------|
| Unit / regression | Node.js (bare) | `dashboard/tests/compute.test.mjs` | KPI computation correctness |
| Data invariant | Node.js (bare) | `dashboard/tests/verify-invariants.mjs` | Loaded JSON data sanity |
| E2E smoke | Playwright | `dashboard/tests/e2e/dashboard.spec.mjs` | All 14 routes render correctly |
| CFO inspection | Playwright | `dashboard/tests/e2e/cfo-inspect.spec.mjs` | Financial cross-checks via DOM |

---

## Test Framework

**Unit/Regression Runner:**
- Node.js `vm` module — no test framework dependency
- Scripts run with `node tests/compute.test.mjs`
- Pass/fail via `process.exit(0/1)` + `console.log('OK ...')` / `console.error('FAIL ...')`

**E2E Runner:**
- Playwright `@playwright/test` v1.59.1
- Config: `dashboard/playwright.config.mjs`
- Chromium only, headless, 1440×900, 30s timeout, 0 retries
- Screenshots on failure only

**Run Commands:**
```bash
# Unit regression test
cd dashboard && node tests/compute.test.mjs

# Data invariant check (requires real dashboard-data.json)
cd dashboard && node tests/verify-invariants.mjs

# Both unit checks
cd dashboard && npm run check

# E2E tests (requires local server on :3399)
cd dashboard && npx playwright test

# Specific E2E spec
cd dashboard && npx playwright test tests/e2e/dashboard.spec.mjs

# CFO inspection spec
cd dashboard && npx playwright test tests/e2e/cfo-inspect.spec.mjs
```

---

## Test File Organization

**Location:** `dashboard/tests/` — separate directory, not co-located

```
dashboard/tests/
├── compute.test.mjs        — unit regression for analytics.js compute()
├── verify-invariants.mjs   — loads real dashboard-data.json and checks invariants
└── e2e/
    ├── dashboard.spec.mjs  — full E2E smoke suite (18 test groups, 60+ tests)
    └── cfo-inspect.spec.mjs — CFO-perspective DOM inspection with cross-checks
```

**File extension:** `.mjs` throughout (native ES modules, no transpilation)

---

## Test Structure

### Unit Tests (compute.test.mjs)

No test framework — manual assertion pattern:

```js
import vm from 'vm'
import fs from 'fs'

// Load IIFE module into isolated VM context
const loadAnalytics = () => {
  const code = fs.readFileSync(path.join(root, 'js', 'analytics.js'), 'utf8')
  const ctx = { window: {}, globalThis: {} }
  ctx.globalThis = ctx.window
  vm.runInNewContext(code, ctx)
  return ctx.window.DashboardAnalytics
}

const { compute } = loadAnalytics()

// Inline fixture
const fixture = {
  meta: { currency: 'KZT' },
  transactions: [
    { id: 't1', date: '2025-06-15', amount: 1000, status: 'paid', ... }
  ],
  ...
}

const r = compute(fixture, filters)

// Manual assertion with float tolerance
if (Math.abs(r.kpi.fact - sumPaid) > 0.01) {
  console.error('FAIL: kpi.fact', r.kpi.fact, 'expected', sumPaid)
  process.exit(1)
}

console.log('OK compute regression (KZT fixture)')
```

Key characteristics:
- `0.01` float tolerance for all numeric assertions
- `process.exit(1)` on failure, `process.exit(0)` (implicit) on pass
- Single fixture per file — no parametrized tests

### Data Invariant Tests (verify-invariants.mjs)

Loads real `data/dashboard-data.json` and verifies structural guarantees:

```js
const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

// Schema check
if (raw.meta?.currency !== 'KZT') {
  console.error('FAIL: meta.currency must be KZT')
  process.exit(1)
}

// Compute with full date range from actual data
const from = raw.transactions.map(t => t.date).sort()[0]
const to   = raw.transactions.map(t => t.date).sort().slice(-1)[0]
const r = compute(raw, { dateFrom: from, dateTo: to, ... })

// Invariant: kpi.fact === sum of paid transactions
const sumPaid = raw.transactions.filter(t => t.status === 'paid').reduce((s,t) => s + t.amount, 0)
if (Math.abs(r.kpi.fact - sumPaid) > 0.01) { ... }
```

### E2E Tests (Playwright)

Standard `@playwright/test` with `test.describe` grouping:

```js
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3399'

async function navigateTo(page, hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500) // let JS render
}

test.describe('Cost Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, 'cost')
  })

  test('renders 5 KPI cards', async ({ page }) => {
    const kpis = page.locator('#cost-kpis .kpi-card')
    await expect(kpis).toHaveCount(5)
  })
})
```

---

## Playwright Configuration

File: `dashboard/playwright.config.mjs`

```js
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npx serve . -l 3399',
    port: 3399,
    reuseExistingServer: true,
    timeout: 10000
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } }
  ]
})
```

- **Single browser:** Chromium only — no cross-browser testing
- `reuseExistingServer: true` — tests can run against a manually-started server
- **No retries** — flaky tests fail immediately

---

## Mocking

**No mocking framework used.**

Dashboard E2E tests run against a real local server serving actual `data/*.json` files. No HTTP interception.

Unit tests use VM isolation (not mocking) to load analytics.js in isolation — other modules are simply absent from the context.

The CFO spec (`cfo-inspect.spec.mjs`) reads real DOM values and performs arithmetic cross-checks — it is the closest to integration testing.

---

## Fixtures and Factories

**Unit fixtures:** inline objects in test files

```js
const fixture = {
  meta: { currency: 'KZT' },
  funnelStages: ['lead', 'contact', 'dialog', 'deal', 'payment'],
  clients: [{ id: 'c1', name: 'A', segment: 'B2C', registeredAt: '2025-01-01' }],
  managers: [{ id: 'm1', name: 'M' }],
  products: [{ id: 'p1', name: 'P' }],
  transactions: [
    { id: 't1', date: '2025-06-15', clientId: 'c1', managerId: 'm1', productId: 'p1',
      amount: 1000, planAmount: 900, status: 'paid', funnelStage: 'payment', source: 'x' }
  ],
  plans: { daily: [...], funnel: {} },
  marketingDaily: [],
  funnelSnapshots: [],
  lossReasons: []
}
```

No factory helpers — fixtures are written inline. Transaction data follows the same schema as `dashboard-data.json`.

---

## Coverage

**Requirements:** None enforced — no coverage tooling configured

**Not tracked:** No Istanbul/c8 coverage

---

## Test Types

### Unit Tests
- **Scope:** Pure computation functions in `dashboard/js/analytics.js` (`compute()`)
- **Approach:** Load module via `vm.runInNewContext`, call function with inline fixture, assert with `0.01` float tolerance
- **File:** `dashboard/tests/compute.test.mjs`

### Data Invariant Tests
- **Scope:** Verifies that the actual `data/dashboard-data.json` satisfies mathematical invariants (e.g. `kpi.fact = sum(paid)`)
- **Approach:** Load real JSON + analytics module, compute with full date range, assert invariants
- **File:** `dashboard/tests/verify-invariants.mjs`
- **Note:** Fails if `data/dashboard-data.json` is missing or malformed

### E2E Smoke Tests
- **Scope:** All 14 navigation routes, KPI card counts, chart canvas presence, table structure, interactive elements
- **Approach:** Navigate to each hash route, assert DOM elements via Playwright locators
- **File:** `dashboard/tests/e2e/dashboard.spec.mjs`
- **Coverage:** 18 `test.describe` groups, every route has at least one test

### CFO Inspection
- **Scope:** Financial cross-checks — reads KPI card values from DOM, parses numbers, validates arithmetic consistency
- **Approach:** Uses helper `parseNum()` to extract numbers from formatted text, `warn()`/`ok()` for soft assertions
- **File:** `dashboard/tests/e2e/cfo-inspect.spec.mjs`
- **Note:** Designed as a slow manual-style inspection (`slowMo: 600ms` in intent, though config inherits defaults)

---

## Common Patterns

### Async Navigation (E2E)
```js
async function navigateTo(page, hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500) // let JS render
}
```

Every test uses `waitForTimeout(500)` after navigation — no smarter wait strategy. This is a known fragility.

### Count Assertions
```js
const kpis = page.locator('#overview-kpis .kpi-card')
await expect(kpis).toHaveCount(5)
```

### Text Contains
```js
await expect(kpiEl).toContainText('Выручка 2025')
```

### Greater Than
```js
const count = await inputs.count()
expect(count).toBeGreaterThan(0)
```

### Computed Style Check
```js
const bg = await first.evaluate(el => getComputedStyle(el).backgroundColor)
expect(bg).toContain('255')
```

### Float Assertion (unit tests)
```js
if (Math.abs(actual - expected) > 0.01) {
  console.error('FAIL:', actual, 'expected', expected)
  process.exit(1)
}
```

---

## What Is NOT Tested

- **Telegram Bot** — no tests at all
- **ETL scripts** — no tests at all
- **CSV import/parsing** (`app.js` — `parseCsv`, `decodeCsvText`) — no unit tests
- **Chart rendering** — only canvas existence is checked, not rendered content
- **LocalStorage persistence** (scenario plan, funnel plan) — not tested
- **Error states** — no tests for missing data, malformed JSON, or network failure
- **Heatmap map interaction** (2GIS SDK) — not tested

---

*Testing analysis: 2026-05-13*
