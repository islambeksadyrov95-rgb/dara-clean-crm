# Research Summary: Dara Clean CRM

**Date:** 2026-05-14
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

## Executive Summary

Dara Clean needs a focused outbound call CRM. Core workflow: manager opens queue of clients sorted by days since last order, calls, logs outcome, creates order on success, sends WhatsApp. Stack: Next.js 15 App Router + Supabase + Vercel. Server Actions for mutations, Route Handlers only for file upload and OpenRouter proxy.

Hard deadline 15 May 2026. Three features block all others: Excel import with phone dedup, call queue, call disposition. Order creation and WhatsApp are day-one valuable but independent. Analytics, RFM, bonus calculators deferred.

Two largest risks: data quality (phones in 7 formats, invalid XML colors) and auth configuration (ISR caching leaks sessions without `force-dynamic`).

## Stack

- **Next.js 15** App Router + Server Actions + RSC
- **Supabase** PostgreSQL + Auth + Realtime
- **shadcn/ui** + Tailwind 4 — RSC-compatible, DataTable for 21K rows
- **xlsx (SheetJS)** for Excel import (openpyxl crashes on Agbis file)
- **openai SDK** → OpenRouter (`google/gemini-flash-1.5`, ~$0.0001/message)
- **`@supabase/ssr`** (not deprecated auth-helpers)
- **`getUser()` not `getSession()`** in middleware

## Features (MVP Scope)

**Must ship:** Excel import + dedup, call queue, call disposition, order creation, WhatsApp generation, basic manager KPI, role access

**Ship if time:** call-back scheduling, RFM labels, repeat rate metric

**Defer:** financial calculator, bonus calculator, segment campaigns, discount admin UI

**Never build:** auto WhatsApp send, scheduling/dispatch, mobile app, email campaigns

## Architecture Patterns

- Server Components → DAL → Server Actions → `revalidatePath`
- Supabase Realtime `postgres_changes` + `router.refresh()` for live call queue
- `locked_by` + `locked_at` with 10-min expiry prevents double-calls
- Service role key: `import 'server-only'` + no `NEXT_PUBLIC_` prefix
- `client_segments` SQL view (not stored) — 21K rows fast enough
- Excel upsert in batches of ~7K rows

## Top Pitfalls

| # | Pitfall | Prevention |
|---|---------|------------|
| P1 | ISR caches Set-Cookie with JWT | `force-dynamic` on every auth page |
| P2 | Phone normalization failure (7 formats) | E.164 pipeline before first INSERT |
| P3 | openpyxl crashes on invalid XML colors | Use xlsx npm package |
| P4 | Supabase free tier pauses at 7 days | Upgrade to Pro ($25/mo) |
| P5 | Two managers call same client | `UPDATE ... WHERE locked_by IS NULL RETURNING id` |

## Suggested Phase Structure

1. **Foundation** — DB schema, Auth, Supabase setup
2. **Excel Import** — Parse Agbis.xlsx, normalize phones, dedup, load to DB
3. **Call Queue + Disposition** — Core daily workflow, Realtime, locking
4. **Order Creation + WhatsApp** — Complete "successful call" happy path
5. **Analytics + KPI** — RFM, repeat rate, manager performance
6. **Deploy + Hardening** — Production config, Pro tier, monitoring

## Confidence

| Area | Level |
|------|-------|
| Stack | HIGH |
| Features (table stakes) | HIGH |
| Architecture | HIGH |
| Pitfalls (critical) | HIGH |

## Open Questions

- RFM thresholds (90 vs 180 days) — owner must validate
- Discount percentages (5/10/15%) — need confirmation
- Manager plan targets for bonus calc — owner homework
- Supabase batch upsert limit — validate during import
- OpenRouter model pricing — recheck at implementation
