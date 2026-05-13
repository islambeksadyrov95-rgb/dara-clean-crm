# Architecture Patterns — Dara Clean CRM

**Domain:** Small-team CRM (carpet cleaning, 3-5 concurrent users)
**Stack:** Next.js 15 App Router + Supabase (PostgreSQL + Auth + Realtime) + Vercel
**Researched:** 2026-05-14
**Confidence:** HIGH (Context7 + official Supabase/Next.js docs)

---

## Recommended Architecture

```
Browser (Manager/Admin)
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  Next.js App Router (Vercel Edge)                   │
│                                                     │
│  app/                                               │
│  ├── (auth)/login          — public, Supabase Auth  │
│  ├── (crm)/                — protected layout       │
│  │   ├── dashboard/        — admin analytics        │
│  │   ├── clients/          — client list + detail   │
│  │   ├── calls/            — call queue (today)     │
│  │   └── orders/           — order creation         │
│  ├── api/                  — Route Handlers only    │
│  │   ├── import/           — Excel upload endpoint  │
│  │   └── ai/whatsapp/      — OpenRouter proxy       │
│  └── lib/                                           │
│      ├── supabase/         — client + server        │
│      ├── dal/              — Data Access Layer       │
│      └── actions/          — Server Actions         │
└────────────────────┬────────────────────────────────┘
                     │  postgres + realtime
                     ▼
┌─────────────────────────────────────────────────────┐
│  Supabase                                           │
│  ├── PostgreSQL (clients, orders, calls, users)     │
│  ├── Auth (email/password, JWT)                     │
│  ├── Realtime (calls table changes)                 │
│  └── Storage (optional: Excel upload buffer)        │
└─────────────────────────────────────────────────────┘
                     │
                     ▼
         OpenRouter API (server-side only)
```

---

## Database Schema

### Core Tables

```sql
-- Imported from Excel. Source of truth for client data.
create table clients (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null unique,          -- dedup key
  name        text,
  address     text,
  district    text,                          -- parsed from address
  created_at  timestamptz default now(),
  imported_at timestamptz,                   -- when row was imported
  source      text default 'agbis'           -- agbis | manual
);

-- One row per historical order (from Excel import + new manual orders)
create table orders (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  manager_id    uuid references auth.users(id),
  service_type  text not null,               -- carpet | curtain | furniture | cleaning
  amount        numeric(12,2) not null,
  discount_pct  smallint default 0,          -- 0 | 5 | 10 | 15
  status        text default 'created',      -- created | confirmed | completed | cancelled
  order_date    date not null,
  notes         text,
  created_at    timestamptz default now()
);

-- Call log: one row per call attempt by a manager
create table calls (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  manager_id    uuid references auth.users(id),
  status        text not null,               -- reached | no_answer | busy | callback
  called_at     timestamptz default now(),
  notes         text,
  next_call_at  timestamptz                  -- set on 'callback'
);

-- Manager profiles + roles (extends auth.users)
create table user_profiles (
  id       uuid primary key references auth.users(id) on delete cascade,
  name     text not null,
  role     text not null default 'manager',  -- manager | admin
  is_active boolean default true
);

-- Configurable app settings (discount grid, KPI targets, etc.)
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);
```

### Indexes

```sql
-- Clients: phone lookup (dedup during import)
create index idx_clients_phone on clients(phone);

-- Clients: time-based segmentation queries
create index idx_orders_client_date on orders(client_id, order_date);
create index idx_orders_date on orders(order_date);

-- Calls queue: "who to call today" query
create index idx_orders_order_date on orders(order_date desc);

-- Calls: manager's daily log
create index idx_calls_manager_date on calls(manager_id, called_at);
```

### Client Segmentation View

```sql
-- Computed at query time, not stored. Fast enough for 21K rows.
create view client_segments as
select
  c.id,
  c.phone,
  c.name,
  count(o.id)           as order_count,
  max(o.order_date)     as last_order_date,
  sum(o.amount)         as total_revenue,
  avg(o.amount)         as avg_check,
  case
    when count(o.id) = 1 then 'new'
    when count(o.id) between 2 and 3 then 'repeat'
    else 'loyal'
  end                   as segment
from clients c
left join orders o on o.client_id = c.id
group by c.id;
```

---

## Row Level Security

**Principle:** All tables have RLS enabled. Managers see all data (shared client pool — no territory split needed at this scale). Admin additionally manages settings.

```sql
-- Enable RLS on all tables
alter table clients       enable row level security;
alter table orders        enable row level security;
alter table calls         enable row level security;
alter table user_profiles enable row level security;
alter table settings      enable row level security;

-- Managers: read all clients/orders/calls (shared pool)
create policy "managers_read_clients"
  on clients for select
  to authenticated
  using (true);

create policy "managers_read_orders"
  on orders for select
  to authenticated
  using (true);

-- Managers: insert/update only their own calls
create policy "managers_write_calls"
  on calls for insert
  to authenticated
  with check (manager_id = auth.uid());

create policy "managers_write_orders"
  on orders for insert
  to authenticated
  with check (manager_id = auth.uid());

-- Settings: only admin reads/writes
create policy "admin_settings"
  on settings for all
  to authenticated
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- user_profiles: own row + admin sees all
create policy "own_profile"
  on user_profiles for select
  to authenticated
  using (id = auth.uid() or
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );
```

**Note:** Service role key (bypass RLS) is used only in server-side import pipeline. Never exposed to browser.

---

## Server Actions vs Route Handlers

**Rule:** Server Actions for all mutations from UI. Route Handlers for non-UI endpoints (file upload, AI proxy).

| Operation | Mechanism | Why |
|-----------|-----------|-----|
| Create order | Server Action | Form submit, revalidatePath |
| Log call result | Server Action | Button click, optimistic UI |
| Update settings | Server Action | Admin form |
| Excel import | Route Handler (POST) | Multipart file upload, streaming |
| OpenRouter WhatsApp | Route Handler (POST) | Hides API key, returns streamed text |
| Client list fetch | Server Component (direct Supabase) | No mutation, RSC reads DB directly |

### Data Access Layer Pattern

```typescript
// lib/dal/clients.ts — 'server-only' module
import 'server-only'
import { createServerClient } from '@/lib/supabase/server'

export async function getClientsToCall(daysAgo: number) {
  const supabase = createServerClient()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysAgo)

  return supabase
    .from('client_segments')
    .select('*')
    .lte('last_order_date', cutoff.toISOString())
    .order('last_order_date', { ascending: true })
}
```

```typescript
// lib/actions/calls.ts — Server Actions
'use server'
import { logCall } from '@/lib/dal/calls'
import { revalidatePath } from 'next/cache'

export async function logCallAction(formData: FormData) {
  const clientId = formData.get('client_id') as string
  const status = formData.get('status') as string
  await logCall({ clientId, status })
  revalidatePath('/calls')
}
```

---

## Realtime — Call Queue

**Use case:** When manager A logs a call, manager B's call queue updates without refresh. This prevents duplicate calls to same client.

**Pattern:** Supabase Realtime postgres changes on `calls` table, client-side subscription in a React context provider.

```typescript
// components/providers/realtime-calls.tsx
'use client'
import { useEffect } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

export function RealtimeCallsProvider({ children }: { children: React.ReactNode }) {
  const supabase = createBrowserClient()

  useEffect(() => {
    const channel = supabase
      .channel('calls-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls'
      }, () => {
        // Trigger router.refresh() to re-fetch server component data
        router.refresh()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return <>{children}</>
}
```

**Important:** `router.refresh()` re-runs Server Components on the server — no client state is lost. This is the correct App Router pattern, not useState updates.

---

## Excel Import Pipeline

**Location:** `app/api/import/route.ts` (Route Handler, server-side)

**Why Route Handler, not Server Action:** File uploads require multipart/form-data streaming. Server Actions technically support this but Route Handlers give cleaner control over large files and error responses.

**Pipeline:**

```
Browser uploads .xlsx
        │
        ▼
POST /api/import
  1. Parse multipart with formData()
  2. Read file buffer
  3. Parse with xlsx (npm) — handles invalid colors unlike openpyxl
  4. Normalize: trim phone, deduplicate
  5. Batch upsert to clients table (conflict on phone → update name/address)
  6. Return { imported, skipped, errors }
```

```typescript
// app/api/import/route.ts
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/admin'  // service role, bypasses RLS

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const buffer = await file.arrayBuffer()

  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[]

  const records = rows.map(normalizeRow).filter(Boolean)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clients')
    .upsert(records, { onConflict: 'phone', ignoreDuplicates: false })

  return NextResponse.json({ imported: records.length, error })
}
```

**xlsx vs openpyxl:** Use `xlsx` npm package (pure JS). The Python `openpyxl` crashes on the Agbis export due to invalid colors in XML. JS `xlsx` is permissive and handles it. Confidence: HIGH (stated in PROJECT.md, confirmed by Python scripts in repo).

**Batch size:** Supabase upsert supports up to ~10K rows per call. For 21K records, split into two batches of 10K to stay within limits.

---

## OpenRouter Integration

**Location:** `app/api/ai/whatsapp/route.ts` (Route Handler)

**Why Route Handler, not Server Action:** API key must never reach the browser. Route Handler runs server-side, receives client request parameters, calls OpenRouter, returns generated text.

```typescript
// app/api/ai/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { clientName, lastService, daysSince, discountPct } = await req.json()

  const prompt = buildWhatsAppPrompt({ clientName, lastService, daysSince, discountPct })

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-3-haiku',  // ~$0.00025/1K tokens, cheapest effective option
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200
    })
  })

  const data = await response.json()
  const message = data.choices[0].message.content

  return NextResponse.json({ message })
}
```

**Estimated cost:** ~200 tokens per message × $0.00025/1K = ~$0.00005/message. 100 messages/day = $0.005/day. Negligible.

---

## Component Architecture

### Page → Component Hierarchy

```
app/(crm)/calls/page.tsx          — Server Component (fetches call queue)
  └── CallQueue                   — Client Component (renders list)
      ├── ClientCard              — pure display
      ├── CallActionButtons       — client, calls Server Action on click
      │   └── logCallAction()     — Server Action → revalidatePath('/calls')
      └── WhatsAppButton          — client, calls /api/ai/whatsapp, opens wa.me link

app/(crm)/clients/page.tsx        — Server Component (paginated list)
  └── ClientsTable                — Client Component (search/filter state)
      └── ClientRow               — pure display
          └── ClientDetailDrawer  — lazy-loaded on click

app/(crm)/orders/new/page.tsx     — Server Component
  └── OrderForm                   — Client Component
      └── createOrderAction()     — Server Action → redirect to /calls

app/(crm)/dashboard/page.tsx      — Server Component (admin only)
  ├── KpiCards                    — pure display (SSR)
  ├── RepeatRateChart             — Client Component (Chart.js)
  └── MotivationCalculator        — Client Component (interactive sliders)
```

### Component Boundaries

| Component | Server/Client | Why |
|-----------|---------------|-----|
| Page components | Server | Direct DB access, no JS to browser |
| Lists/Tables with search | Client | Need useState for filters |
| Forms with validation | Client | Need controlled inputs |
| Charts | Client | Chart.js requires DOM |
| Action buttons | Client | onClick handlers |
| Static KPI cards | Server | Pure display, no interactivity |

**Rule:** Default to Server Components. Add `'use client'` only when the component needs browser APIs, event handlers, or React hooks.

---

## Data Flow

### Call Queue — Happy Path

```
1. Manager opens /calls
2. Server Component runs getClientsToCall(90)  ← last ordered 90+ days ago
3. Supabase returns sorted client list (Server, no client JS)
4. Page renders as HTML with client-side CallActionButtons hydrated
5. Manager clicks "Дозвонился" → logCallAction() fires
6. Server Action writes to calls table → revalidatePath('/calls')
7. Next.js re-renders Server Component → fresh list (call removed from queue)
8. Realtime channel INSERT event → other managers see update via router.refresh()
```

### Order Creation — Happy Path

```
1. Manager clicks "Создать заказ" on ClientCard
2. Navigate to /orders/new?client_id=xxx
3. Server Component pre-fetches client data
4. OrderForm renders with client pre-filled
5. Manager fills service type, amount → submit
6. createOrderAction() validates, writes to orders table
7. Server Action redirects to /calls (back to queue)
```

### Excel Import — Admin Flow

```
1. Admin opens /dashboard → Import section
2. Selects .xlsx file → client reads File object
3. POST /api/import with FormData
4. Route Handler: XLSX.read(buffer) → normalize → upsert(clients, { onConflict: 'phone' })
5. Returns { imported: N, skipped: M }
6. Admin sees result toast
```

---

## Build Order (Phase Dependencies)

Build in this order — each layer depends on the previous:

1. **Database + Auth** — Supabase tables, RLS, auth.users, user_profiles. Everything depends on this.

2. **Supabase client wrappers** — `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/admin.ts`. DAL depends on these.

3. **Auth flow** — `app/(auth)/login`, middleware for route protection. All CRM pages depend on authenticated session.

4. **Excel import pipeline** — `app/api/import/route.ts`. Must run before CRM has real data to show. Prerequisite for all other features.

5. **Client list + detail** — `app/(crm)/clients/`. Read-only views. Validates schema is correct before building mutations.

6. **Call queue** — `app/(crm)/calls/`. Core daily workflow. Depends on clients data existing.

7. **Order creation** — `app/(crm)/orders/new/`. Depends on call queue (triggered from there).

8. **Realtime** — Add after call queue works. Isolated feature, enhances UX but not blocking.

9. **WhatsApp generation** — `app/api/ai/whatsapp/`. Independent, add to call queue UI after core flow works.

10. **Analytics dashboard** — `app/(crm)/dashboard/`. Depends on orders data accumulating. Build last.

11. **Motivation calculators + settings** — Admin-only features. Build after core CRM is stable.

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server Actions vs API routes for mutations | Server Actions | Colocated with UI, automatic CSRF, revalidatePath built-in |
| OpenRouter call location | Route Handler | API key protection — never to browser |
| Excel parsing library | xlsx (npm) | openpyxl crashes on Agbis export (invalid XML colors) |
| Realtime mechanism | Postgres Changes subscription | Simpler than Presence, matches use case (row changes not user state) |
| RLS strategy | All-authenticated-read + own-writes | 3-5 managers share pool, no territory split needed |
| Client segmentation | SQL view (not stored) | 21K rows is fast enough, avoids sync complexity |
| Supabase client creation | Per-request server client | Correct for App Router — no global singleton on server |

---

## Anti-Patterns to Avoid

### Singleton Supabase client on server
**What:** `const supabase = createClient(...)` at module level in a Server Component
**Why bad:** Leaks auth context between requests on Vercel (serverless, shared module cache)
**Instead:** Call `createServerClient()` inside each Server Component or DAL function

### Direct Supabase calls in Client Components
**What:** `supabase.from('orders').select(...)` inside a `'use client'` component
**Why bad:** Exposes anon key patterns, bypasses DAL security checks, duplicates auth logic
**Instead:** Fetch in Server Component, pass as props. Or use Server Action for mutations.

### Service role key in browser-accessible code
**What:** Using `SUPABASE_SERVICE_ROLE_KEY` in any file without `server-only` guard
**Why bad:** If accidentally bundled, exposes full DB bypass to public
**Instead:** `import 'server-only'` at top of `lib/supabase/admin.ts`. Vercel will fail build if this is imported from client.

### Polling for real-time updates
**What:** `setInterval(() => fetchCalls(), 5000)` in client component
**Why bad:** Unnecessary load, stale between intervals, poor UX
**Instead:** Supabase Realtime postgres_changes + `router.refresh()`

### Storing all 21K clients in React state
**What:** Fetch all clients on mount, filter client-side
**Why bad:** 21K rows × ~200 bytes = ~4MB payload, slow initial load, memory pressure
**Instead:** Server-side pagination + search (ILIKE query with limit/offset)

---

## Sources

- Supabase RLS: https://supabase.com/docs/guides/auth/row-level-security (Context7, HIGH confidence)
- Next.js Server Actions: https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/data-security.mdx (Context7, HIGH confidence)
- Next.js Route Handlers: https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/15-route-handlers.mdx (Context7, HIGH confidence)
- Supabase Realtime postgres_changes: https://supabase.com/docs/guides/realtime/postgres-changes (Context7, HIGH confidence)
- xlsx npm: https://www.npmjs.com/package/xlsx (standard library, HIGH confidence)
- OpenRouter pricing: https://openrouter.ai/models (MEDIUM confidence — prices change)
