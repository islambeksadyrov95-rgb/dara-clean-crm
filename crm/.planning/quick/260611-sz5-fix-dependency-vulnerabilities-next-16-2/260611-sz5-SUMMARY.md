---
phase: quick-260611-sz5
plan: "01"
subsystem: dependencies
tags: [security, cve, dependencies, next, xlsx]
dependency_graph:
  requires: []
  provides: [patched-next-16.2.9, patched-xlsx-0.20.3]
  affects: [crm/package.json, crm/package-lock.json]
tech_stack:
  added: []
  patterns: [SheetJS CDN tarball install]
key_files:
  modified:
    - crm/package.json
    - crm/package-lock.json
decisions:
  - "xlsx fix sourced from SheetJS CDN (cdn.sheetjs.com/xlsx-0.20.3.tgz) — npm registry has no patched build for CVEs"
  - "eslint-config-next bumped in lockstep with next (required: must match exactly)"
metrics:
  duration: "~5 min"
  completed: "2026-06-11"
  tasks_completed: 2
  files_changed: 2
---

# Phase quick-260611-sz5 Plan 01: Fix Dependency Vulnerabilities Summary

## One-liner

Bumped next 16.2.6→16.2.9 (MEDIUM CVE) and xlsx 0.18.5→SheetJS CDN 0.20.3 (HIGH CVE-2023-30533 prototype pollution + CVE-2024-22363 ReDoS); build passes 0 errors, no xlsx HIGH in audit.

## What Was Done

### Task 1 — Bump next/eslint-config-next to 16.2.9 and pin xlsx to SheetJS CDN 0.20.3

Edited `crm/package.json` with exactly three changes:
- `"next": "16.2.6"` → `"next": "16.2.9"` (dependencies)
- `"eslint-config-next": "16.2.6"` → `"eslint-config-next": "16.2.9"` (devDependencies)
- `"xlsx": "^0.18.5"` → `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (dependencies)

No other dependency lines were modified.

### Task 2 — Reinstall, regenerate lockfile, verify build + audit clean

- `npm install` completed successfully; `package-lock.json` regenerated with `xlsx` resolved from `cdn.sheetjs.com/xlsx-0.20.3`
- `npm run build` (Next.js 16.2.9 Turbopack): compiled successfully in 10.8s, TypeScript finished in 12.0s, 0 errors
- All three xlsx callers compiled unchanged: `lib/motivation-excel.ts`, `app/(protected)/import/page.tsx`, `app/(protected)/sales-plans/actions.ts`
- `npm audit`: xlsx absent from vulnerabilities — no HIGH or CRITICAL advisory for xlsx remains
- Remaining 4 moderate advisories: hono, postcss (in next's transitive deps — fixing would require downgrade to next@9.3.3 which is a breaking change), qs — all out of scope for this task

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| `56f6214` | `fix(security): bump next to 16.2.9 + xlsx to SheetJS CDN 0.20.3 (CVE-2023-30533, CVE-2024-22363)` | `crm/package.json`, `crm/package-lock.json` |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Review

- [x] All changes match plan intent (exactly 3 lines in package.json, lockfile regenerated)
- [x] No R1-R13 violations found (no source code changes)
- [x] Browser verification N/A (no UI changes)
- [x] Verified staged diff before commit: only package.json + package-lock.json, no unrelated files

## Self-Check: PASSED

- [x] `crm/package.json` — next=16.2.9, eslint-config-next=16.2.9, xlsx=CDN 0.20.3
- [x] `crm/package-lock.json` — xlsx resolved to `cdn.sheetjs.com/xlsx-0.20.3`
- [x] `npm run build` — 0 errors
- [x] `npm audit` — xlsx not in vulnerabilities
- [x] Commit `56f6214` exists on branch `worktree-agent-a4103b03d1d753ceb`
