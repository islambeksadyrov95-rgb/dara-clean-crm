# Phase 3: Excel Import - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin uploads База Агбис.xlsx via file input. System parses on client (SheetJS), normalizes phones to E.164, deduplicates by phone, calculates aggregates (total_orders, total_spent, avg_order_value), assigns RFM segments, and upserts into Supabase. Result screen shows created/updated/skipped counts.

</domain>

<decisions>
## Implementation Decisions

### Processing
- Client-side Excel parsing via SheetJS (xlsx library) — openpyxl crashes on this file
- Parsed data sent as JSON to a Server Action
- Server Action uses Supabase service role key (bypasses RLS) for bulk insert
- Batch upsert in chunks of 500 rows
- Upsert by phone — duplicate phones update existing client record

### UX
- Simple progress bar during batch insert + final result summary
- Skip bad rows (missing phone, invalid data) — count as "skipped"
- Result screen: created N / updated M / skipped K

### Phone Normalization
- Normalize to E.164: +7XXXXXXXXXX
- Handle formats: 87001234567, +77001234567, 7(700)123-45-67, 8(700) 123 45 67, etc.
- Strip all non-digits, then: if starts with 8 and 11 digits → replace 8 with +7; if starts with 7 and 10 digits → prepend +7

### Claude's Discretion
- SheetJS import method (cdn vs npm)
- Exact UI layout of import page
- Error message wording

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- crm/app/(protected)/import/page.tsx — stub page (admin-only)
- crm/lib/supabase/server.ts — server client
- crm/supabase/migrations/001_schema.sql — clients table schema

### Established Patterns
- shadcn/ui components (Button, Card, Input)
- Server Actions for mutations
- force-dynamic on protected pages

### Integration Points
- Need SUPABASE_SERVICE_ROLE_KEY env var for admin operations
- clients table: name, phone, address, total_orders, total_spent, avg_order_value, last_order_date

</code_context>

<specifics>
## Specific Ideas

Excel file structure (База Агбис.xlsx):
- 21,388 rows grouped by order date
- Columns: дата заказа, имя, адрес, телефон, стоимость, услуга
- Multiple rows per client (one per order) — need to group by phone

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
