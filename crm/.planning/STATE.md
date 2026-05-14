# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** Менеджер открывает систему, видит кому звонить сегодня, за 2 клика создаёт заказ или отправляет WhatsApp
**Current focus:** Phase 2 — Database Schema + RLS

## Current Position

Phase: 2 of 9 (Database Schema + RLS)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-05-14 — Phase 1 complete (Next.js + Supabase Auth + middleware)

Progress: [█░░░░░░░░░] 11%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

**Recent Trend:** No data yet

## Accumulated Context

### Decisions

- Roadmap: xlsx (SheetJS) for Excel import — openpyxl crashes on invalid XML colors in Агбис file
- Roadmap: `@supabase/ssr` + `getUser()` in middleware (not deprecated auth-helpers, not `getSession()`)
- Roadmap: `force-dynamic` on all auth pages to prevent ISR caching session cookies
- Roadmap: `UPDATE ... WHERE locked_by IS NULL RETURNING id` for atomic call locking (prevents double-calls)
- Roadmap: OpenRouter `google/gemini-flash-1.5` for WhatsApp generation (~$0.0001/message)

### Pending Todos

None yet.

### Blockers / Concerns

- RFM thresholds (90 vs 180 days for В риске / Потерянный) — owner must confirm before Phase 3
- Discount percentages (5/10/15%) — confirm with owner before Phase 7
- Supabase tier: free tier pauses after 7 days inactivity — upgrade to Pro before Phase 9

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | MOT-01..04 KPI calculators | Deferred | Roadmap |
| v2 | FIN-01..03 Financial calculator | Deferred | Roadmap |
| v2 | ANL-01..03 Analytics dashboard | Deferred | Roadmap |
| v2 | ADV-01..03 Advanced CRM | Deferred | Roadmap |

## Session Continuity

Last session: 2026-05-14
Stopped at: Phase 1 complete. Phase 2 context written, ready to plan.
Resume file: None
