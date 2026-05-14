# Phase 2: Database Schema + RLS - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase)

<domain>
## Phase Boundary

All tables, constraints, indexes, and Row Level Security policies exist so every subsequent phase can write and read data correctly. Tables: clients, orders, call_logs. RLS for manager (own data) and admin (all data). client_segments SQL view for RFM labels.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from STATE.md:
- RFM thresholds: Новый (1 заказ), Повторный (2-3), Постоянный (4+), В риске (>90 дней), Потерянный (>180 дней)
- Supabase PostgreSQL with RLS
- user_metadata.role for auth (from Phase 1)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- crm/lib/supabase/server.ts — server client for DB operations
- crm/middleware.ts — auth middleware with role check

### Established Patterns
- Supabase Auth with user_metadata.role
- @supabase/ssr for server-side access

### Integration Points
- Supabase SQL Editor for migrations
- auth.uid() for RLS policies linking to user

</code_context>

<specifics>
## Specific Ideas

Data from База Агбис.xlsx (Phase 3 will import):
- Columns: дата заказа, имя, адрес, телефон, стоимость, услуга
- 21,388 rows of client order data
- Phone normalization to E.164 needed

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
