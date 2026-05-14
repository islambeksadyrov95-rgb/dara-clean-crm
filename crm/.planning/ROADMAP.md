# Roadmap: Dara Clean CRM

## Overview

Nine phases from zero to production. Phases 1-2 lay the infrastructure foundation (auth, schema, RLS). Phase 3 loads the 21K-row client base from Excel. Phase 4 makes clients browsable. Phases 5-6 implement the core daily workflow: call queue with locking, then disposition (success/failure). Phases 7-8 complete the happy path: order creation and WhatsApp generation. Phase 9 deploys to Vercel and hardens the production config. Deadline: 2026-05-15.

## Phases

- [x] **Phase 1: Auth + Project Setup** - Next.js project, Supabase connection, email/password auth with two roles
- [x] **Phase 2: Database Schema + RLS** - All tables, indexes, Row Level Security policies, Realtime enabled
- [x] **Phase 3: Excel Import** - Parse Агбис.xlsx, normalize phones, deduplicate, load 21K clients into DB
- [ ] **Phase 4: Client Table + Card** - Browsable client list with search/filter, individual client card with order history
- [ ] **Phase 5: Call Queue + Locking** - Filtered queue by days since last order, per-client locking, Realtime sync
- [ ] **Phase 6: Call Disposition** - Reached/not-reached buttons, day statistics for manager
- [ ] **Phase 7: Order Creation** - 4-service order form, auto discount calculation, save with manager attribution
- [ ] **Phase 8: WhatsApp Integration** - OpenRouter message generation, fallback template, wa.me deep link
- [ ] **Phase 9: Deploy + Hardening** - Vercel production deploy, env vars, Supabase Pro, smoke test

## Phase Details

### Phase 1: Auth + Project Setup
**Mode:** mvp
**Goal:** Managers and admin can log in with email/password and access role-appropriate sections
**Depends on:** Nothing (first phase)
**Requirements:** AUTH-01, AUTH-02, AUTH-03, INF-02
**Success Criteria** (what must be TRUE):
  1. Manager can log in with email/password and land on the call queue page
  2. Admin can log in and see the import section that a manager cannot access
  3. Logged-out user is redirected to login page when accessing any protected route
  4. Supabase project exists with PostgreSQL and Auth configured
**Plans**: TBD
**UI hint**: yes

### Phase 2: Database Schema + RLS
**Mode:** mvp
**Goal:** All tables, constraints, indexes, and Row Level Security policies exist so every subsequent phase can write and read data correctly
**Depends on:** Phase 1
**Requirements:** INF-02 (shared — RLS is part of Supabase infra; primary mapping is Phase 1, schema is the second INF-02 deliverable)
**Requirements:** (schema supports all future requirements — no standalone requirement IDs; INF-02 covers Supabase DB setup)
**Success Criteria** (what must be TRUE):
  1. Tables clients, orders, call_logs exist with correct columns and foreign keys
  2. RLS policies allow manager to read/write only their own call_logs and orders
  3. RLS policies allow admin to read all rows in all tables
  4. client_segments SQL view returns RFM segment labels without stored computation
**Plans**: TBD

### Phase 3: Excel Import
**Mode:** mvp
**Goal:** Admin can upload Агбис.xlsx through a web form and have 21K client records loaded, deduplicated, and RFM-segmented in the database
**Depends on:** Phase 2
**Requirements:** IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06
**Success Criteria** (what must be TRUE):
  1. Admin uploads Агбис.xlsx via a file input and sees a progress/result summary
  2. All phone numbers are normalized to E.164 (+7XXXXXXXXXX) regardless of input format
  3. Duplicate phones merge into one client record (not duplicate rows)
  4. Each client record shows total orders count, total spent, and average order value
  5. Each client has an RFM segment label: Новый, Повторный, Постоянный, В риске, or Потерянный
  6. Result screen shows: created N / updated M / skipped K
**Plans**: TBD
**UI hint**: yes

### Phase 4: Client Table + Card
**Mode:** mvp
**Goal:** Managers can browse all clients, filter by segment, search by name or phone, and open a client card with full order and call history
**Depends on:** Phase 3
**Requirements:** CLT-01, CLT-02, CLT-03
**Success Criteria** (what must be TRUE):
  1. Manager sees a paginated table of clients with columns: имя, телефон, сегмент, заказов, потрачено, последний заказ, дней без заказа
  2. Manager can type in a search box and table filters to matching clients in real time
  3. Manager can filter table by RFM segment (Новый / Повторный / Постоянный / В риске / Потерянный)
  4. Manager clicks a client row and sees the client card with all past orders and call log entries
**Plans**: TBD
**UI hint**: yes

### Phase 5: Call Queue + Locking
**Mode:** mvp
**Goal:** Manager sees a queue of clients sorted by days since last order, each client is locked exclusively to one manager for 10 minutes to prevent double-calls, and queue updates in real time across all manager sessions
**Depends on:** Phase 4
**Requirements:** CRM-01, CRM-02, CRM-03, CRM-06, INF-03
**Success Criteria** (what must be TRUE):
  1. Manager sees only clients whose last order was N or more days ago (N is configurable via a filter control)
  2. Queue is sorted oldest-last-order first
  3. When manager starts a call, that client is locked to them and disappears from other managers' queues
  4. Lock expires after 10 minutes and client re-appears in queue if no disposition was recorded
  5. Queue updates without page reload when another manager locks or releases a client
**Plans**: TBD
**UI hint**: yes

### Phase 6: Call Disposition
**Mode:** mvp
**Goal:** Manager records the outcome of each call — reached or not reached — and sees daily statistics for their own calls
**Depends on:** Phase 5
**Requirements:** CRM-04, CRM-05, CRM-06
**Success Criteria** (what must be TRUE):
  1. Manager presses "Дозвонился" and is presented immediately with the order creation form
  2. Manager presses "Не дозвонился" and sees a pre-generated WhatsApp message ready to send
  3. Call disposition is saved (call_logs row) linked to the client and manager
  4. Manager sees day statistics: total calls made, successful connects, orders created today
**Plans**: TBD
**UI hint**: yes

### Phase 7: Order Creation
**Mode:** mvp
**Goal:** Manager creates an order in 4 fields after a successful call, discount is calculated automatically by the rules, and the order is saved linked to client and manager
**Depends on:** Phase 6
**Requirements:** ORD-01, ORD-02, ORD-03, ORD-04
**Success Criteria** (what must be TRUE):
  1. Manager selects one or more services (ковры / шторы / мебель / клининг) and enters a total amount
  2. System displays calculated discount automatically: 5% for repeat client, 10% if amount >30K, 15% for complex (2+ services)
  3. Manager adds an optional comment and submits — order is saved
  4. Saved order appears in client history card with manager name, date, services, amount, and applied discount
**Plans**: TBD
**UI hint**: yes

### Phase 8: WhatsApp Integration
**Mode:** mvp
**Goal:** After a "not reached" disposition, manager gets a personalized WhatsApp message generated by AI and can open WhatsApp with one click pre-filled with that message
**Depends on:** Phase 6
**Requirements:** WA-01, WA-02, WA-03, WA-04
**Success Criteria** (what must be TRUE):
  1. System generates a personalized message via OpenRouter containing client name, days since last order, and current discount offer
  2. Manager can read the generated message and copy it to clipboard
  3. "Открыть WhatsApp" button opens wa.me deep link with the client's phone and the message pre-filled as URL parameter
  4. If OpenRouter API key is missing or call fails, a template-based fallback message is shown instead of an error
**Plans**: TBD
**UI hint**: yes

### Phase 9: Deploy + Hardening
**Mode:** mvp
**Goal:** Application is live on Vercel at a public URL, all environment variables are configured, and the system passes a smoke test covering login, call queue, and order creation
**Depends on:** Phase 8
**Requirements:** INF-01
**Success Criteria** (what must be TRUE):
  1. Application is accessible at a Vercel production URL without errors
  2. All auth routes use `force-dynamic` so ISR does not cache session cookies
  3. Manager can log in, see call queue, lock a client, create an order — end to end on production
  4. Environment variables (Supabase URL, anon key, service role key, OpenRouter key) are set in Vercel and not exposed to client bundle
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute sequentially: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Auth + Project Setup | 2/2 | Complete | 2026-05-14 |
| 2. Database Schema + RLS | 1/1 | Complete | 2026-05-14 |
| 3. Excel Import | 1/1 | Complete | 2026-05-14 |
| 4. Client Table + Card | 0/? | Not started | - |
| 5. Call Queue + Locking | 0/? | Not started | - |
| 6. Call Disposition | 0/? | Not started | - |
| 7. Order Creation | 0/? | Not started | - |
| 8. WhatsApp Integration | 0/? | Not started | - |
| 9. Deploy + Hardening | 0/? | Not started | - |
