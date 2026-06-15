---
title: "260615-q7f: Queue Plan-Dnya targets fully dynamic from sales_plans"
type: quick-task
status: completed
project: crm
created: 2026-06-15
---

# Quick Task 260615-q7f: Dynamic «План дня» Targets

**One-liner:** Replaced all hardcoded daily targets (85000/5/22/17000) in the queue header with live values derived from `public.sales_plans.repeat_target` ÷ real calendar weekdays, with admin dept-aggregate scope and «план не задан» guard for missing plans.

## What Changed

### New file: `lib/daily-targets.ts`
Two pure exported functions (no imports, no `any`, each ≤30 lines):
- `workingWeekdaysInMonth(year, month1to12)` — counts Mon–Fri days in month, floors to 1
- `deriveDailyTargets(input)` — computes revenuePerDay/ordersPerDay/callsPerDay from repeat plan; returns 0s (not hardcoded fallback) when plan absent

### New file: `tests/daily-targets.test.ts`
10 vitest cases covering all behavior bullets: June-2026 weekday count (22), zero plan, dept managerCount=2, avgCheck=0 crash guard, workingDays=0 floor, managerCount=0 floor.

### Modified: `app/(protected)/queue/actions.ts`
- Added imports: `getUserRole` (was missing here), `deriveDailyTargets`, `workingWeekdaysInMonth`
- Extracted `getTodayFacts(supabase, { managerId }, todayUtc)` — when `managerId=null` (admin) omits `manager_id` filter so facts span all managers; WhatsApp exclusion preserved
- Extracted `getDailyTargets(supabase, { isAdmin, userId, month, year })` — reads `crm_settings` once with `.in(['day_target','sales_plan'])`; personal path reads own `sales_plans.repeat_target`; admin path sums all rows + counts active managers from `profiles`
- `getDayStats()` now returns 9 fields: original 8 + `scope: 'personal' | 'department'`
- Hardcoded 85000/5/22/17000 removed from active path (retained only in `!user` unauthenticated guard)

### Modified: `app/(protected)/queue/page.tsx`
- `DayStats` type: added `scope: 'personal' | 'department'`
- Default seed: `scope: 'personal'`
- Widget render:
  - «Отдел» badge shown when `stats.scope === 'department'`
  - Звонки: progress bar + divisor only when `dayTargetCalls >= 1`
  - Заказы: progress bar + `/N` only when `planOrdersPerDay > 0`; else «/план не задан»
  - Выручка: target side shows «/план не задан» when `planRevenuePerDay === 0`
  - No division-by-zero in any `style={{ width: ... }}` expression

### Modified: `tests/disposition.test.ts`
- Added `.in()` to `crmSettingsChain` mock (new query pattern)
- Added `scope: 'personal'` to both getDayStats expected results
- Updated `planRevenuePerDay/planOrdersPerDay` from 85000/5 to 0/0 for the «no plan row» scenario (correct new behavior)

## Commits

| Hash | Message |
|------|---------|
| b2ed7c2 | feat(queue): add workingWeekdaysInMonth + deriveDailyTargets pure helpers |
| 709b7ea | feat(queue): scope-aware getDayStats + dynamic plan-dnya widget |

## Verification

- `npm run test` (excluding e2e): **295/295 passed** (52 test files)
- `npm run build`: **0 errors**, all 28 routes compiled
- New `tests/daily-targets.test.ts`: 10/10 passed (TDD RED→GREEN confirmed)
- Existing `tests/disposition.test.ts`: 5/5 passed after mock update

## Self-Review

- [x] All changes match plan intent (Q7F-DYNAMIC-TARGETS)
- [x] No hardcoded 85000/5/22/17000 in active getDayStats path
- [x] Admin facts path has no manager_id filter (verified in diff)
- [x] WhatsApp exclusion (WHATSAPP_SUB_STATUS) preserved in all call_log queries
- [x] Each function ≤30 lines (checked: getTodayFacts=23, getDailyTargets=27, getDayStats=17)
- [x] No `as any`, no `select('*')` in new or modified code
- [x] No division-by-zero: all progress bar widths guarded with > 0 condition
- [x] motivation/* and dashboard/* untouched (their WORKING_DAYS_PER_MONTH=22 stays)
- [x] Queue filtering/locks/auto-select logic untouched
- [x] getDayStats original 8 field names preserved, `scope` added as 9th
- [x] Build verified GREEN after all changes

## Known Stubs

None. All targets are wired to live DB data (`sales_plans` + `crm_settings`).

## Self-Check: PASSED

- lib/daily-targets.ts: EXISTS
- tests/daily-targets.test.ts: EXISTS
- Commits b2ed7c2, 709b7ea: FOUND in git log
