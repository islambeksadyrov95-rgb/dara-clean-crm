# Technology Stack

**Project:** Dara Clean CRM
**Researched:** 2026-05-14
**Confidence:** HIGH (Context7 + official Supabase/Next.js docs verified)

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js | 15.x (App Router) | Full-stack React framework | Server Actions handle form mutations without API routes; RSC fetch data directly from Supabase on the server; Vercel deploy is zero-config |
| React | 19.x | UI runtime | Ships with Next.js 15, `useActionState` + `useFormStatus` replace most client state for forms |
| TypeScript | 5.x strict | Type safety | Already used in Telegram Bot; Supabase generates types from schema |

**App Router vs Pages Router:** Use App Router. Pages Router is legacy. For a CRM with 3-5 users, RSC + Server Actions eliminate boilerplate: no `useEffect` data fetching, no separate API routes for mutations.

**Server Actions pattern for CRM:**
```tsx
// app/calls/actions.ts
'use server'
import { createClient } from '@/lib/supabase/server'

export async function markCallDone(clientId: string, status: 'reached' | 'missed') {
  const supabase = await createClient()
  const { error } = await supabase
    .from('call_log')
    .insert({ client_id: clientId, status, called_at: new Date().toISOString() })
  if (error) throw error
  revalidatePath('/calls')
}
```

### Database & Backend

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Supabase | Free tier initially | PostgreSQL + Auth + RLS | Hosted Postgres, Auth out of box, RLS enforces multi-user isolation without application code, JS client works in RSC |
| @supabase/ssr | latest | Server-side Supabase client | Official package for Next.js App Router; replaces deprecated @supabase/auth-helpers |
| @supabase/supabase-js | 2.x | Client-side Supabase | For real-time subscriptions and client component queries |

**Auth setup:** Supabase email/password with `@supabase/ssr` + middleware cookie refresh. No OAuth needed. Middleware intercepts every request, calls `supabase.auth.getUser()`, redirects to `/login` if no session. This is the only correct pattern for App Router — do not use `getSession()` on the server (it doesn't validate JWT).

```typescript
// middleware.ts
import { createServerClient } from '@supabase/ssr'
// ... standard proxy pattern (see Supabase docs: /guides/auth/server-side/nextjs)
```

**RLS policy pattern for 3-5 users:** Keep it simple. Add a `role` column to `auth.users` via a `profiles` table. Two roles: `manager` and `admin`. Managers can INSERT call logs and orders; admins can do everything.

```sql
-- All authenticated users read clients
create policy "managers read clients"
  on clients for select
  using (auth.uid() is not null);

-- Only managers from own calls can insert call_log
create policy "managers insert own calls"
  on call_log for insert
  with check (auth.uid() = manager_id);
```

### UI Components

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| shadcn/ui | 2.x (CLI: `shadcn@latest`) | Component library | Not a package — copies source into your project. Full control, no dependency lock-in. Radix UI primitives, Tailwind styling. Has DataTable (TanStack Table), Command (search), Dialog, Sheet, Combobox — all needed for CRM |
| Tailwind CSS | 4.x | Utility CSS | Ships with shadcn; v4 uses CSS-first config, faster builds |
| TanStack Table | 8.x | Table state | Used by shadcn DataTable for sorting, filtering, pagination of 21K client records |

**shadcn/ui vs alternatives:**

- **shadcn/ui** — correct choice. Source-owned components, works perfectly with RSC (no "use client" forced on everything), Radix accessibility built-in.
- **Ant Design** — avoid. Heavy bundle, opinionated styling hard to override, poor RSC compatibility.
- **MUI** — avoid. Emotion CSS-in-JS conflicts with App Router streaming; bundle too large for this use case.
- **Mantine** — viable but more opinionated, larger bundle than shadcn.

**Key shadcn components for CRM:**
```bash
npx shadcn@latest add table data-table command dialog sheet combobox badge button input form select
```

### Form Handling & Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| react-hook-form | 7.x | Form state | Client-side form state; integrates with Server Actions via `useActionState` in React 19 |
| zod | 3.x | Schema validation | Same schema runs on client (RHF resolver) and server (Server Action guard); already used in Telegram Bot |

**Pattern:** Define one Zod schema per form. Pass it to RHF `zodResolver` for instant client validation. Re-validate in Server Action before DB write. Never trust client data.

### Data Fetching

| Technology | When to Use |
|------------|------------|
| RSC async/await | Default for all page-level data. No extra library needed. Fetch in `page.tsx`, pass props down |
| SWR | Only for client components needing real-time polling (call list refresh). 4.2KB, Vercel-native |
| TanStack Query | Skip. Overkill for 3-5 users, adds 13KB for features you won't use |

For 21K client records: paginate with Supabase `.range()`, never fetch all. Default page size 50.

### Excel Import

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| xlsx (SheetJS) | 0.18.5 | Parse Excel server-side | Already in the project (etl/ uses openpyxl, but SheetJS is in dashboard). Run import as Next.js API Route (not Server Action — file uploads need `Request` object). Stream-parse; don't load 21K rows into memory at once |

**Import route pattern:**
```typescript
// app/api/import/route.ts
import * as XLSX from 'xlsx'

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws)
  // deduplicate by phone, upsert to Supabase
}
```

**Why API Route here (not Server Action):** File uploads with `multipart/form-data` are cleaner in Route Handlers. Server Actions work but require manual `formData.get('file')` and have a 1MB body limit by default in some configs.

**Known issue with source data:** `openpyxl` fails on База Агбис.xlsx due to invalid XML colors — SheetJS (xlsx) does not have this issue. It is more permissive with malformed xlsx.

### AI Integration (OpenRouter)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| openai (SDK) | 4.x | OpenRouter client | OpenRouter is OpenAI-compatible. Use `openai` SDK pointed at `https://openrouter.ai/api/v1`. No separate SDK needed |

**Implementation:**
```typescript
// app/api/generate-whatsapp/route.ts  (API Route, not Server Action)
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'https://daraclean.kz' }
})

export async function POST(req: Request) {
  const { clientName, lastService, daysSince } = await req.json()
  const completion = await client.chat.completions.create({
    model: 'google/gemini-flash-1.5',  // ~$0.00007/1K tokens, fast
    messages: [{ role: 'user', content: buildPrompt(clientName, lastService, daysSince) }]
  })
  return Response.json({ message: completion.choices[0].message.content })
}
```

**Why API Route (not Server Action) for OpenRouter:** Streaming responses are easier from Route Handlers. Server Actions don't support streaming. If you need streaming later, Route Handlers are the only path.

**Model recommendation:** `google/gemini-flash-1.5` for WhatsApp generation. Fast, cheap (~$0.0001/message), good Russian language quality. Fallback: `mistralai/mistral-7b-instruct` (free tier on OpenRouter).

### Infrastructure

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vercel | Free/Pro | Hosting | Zero-config Next.js deploy, automatic preview URLs, edge middleware |
| Supabase | Free tier | Database + Auth | Free: 500MB DB, 2GB bandwidth, unlimited auth users — enough for MVP |

---

## Supabase Schema Design

Core tables for CRM:

```sql
-- Client base (imported from Excel)
create table clients (
  id            uuid primary key default gen_random_uuid(),
  phone         text unique not null,        -- dedup key
  name          text,
  address       text,
  last_order_at timestamptz,
  last_service  text,                        -- 'ковры' | 'шторы' | 'мебель' | 'клининг'
  total_spent   numeric(12,2) default 0,
  order_count   int default 0,
  segment       text generated always as (   -- computed, update via trigger
    case
      when order_count = 1 then 'new'
      when order_count between 2 and 4 then 'repeat'
      else 'loyal'
    end
  ) stored,
  created_at    timestamptz default now()
);

-- Individual orders
create table orders (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) not null,
  manager_id    uuid references auth.users(id) not null,
  service       text not null,
  amount        numeric(10,2) not null,
  discount_pct  int default 0,
  final_amount  numeric(10,2) generated always as (amount * (1 - discount_pct::numeric/100)) stored,
  status        text default 'pending',     -- 'pending' | 'confirmed' | 'done'
  created_at    timestamptz default now()
);

-- Call tracking
create table call_log (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) not null,
  manager_id    uuid references auth.users(id) not null,
  status        text not null,              -- 'reached' | 'missed' | 'callback'
  notes         text,
  called_at     timestamptz default now()
);

-- Manager profiles (extends auth.users)
create table profiles (
  id            uuid primary key references auth.users(id),
  full_name     text,
  role          text default 'manager'      -- 'manager' | 'admin'
);
```

**Indexes:**
```sql
create index on clients (phone);
create index on clients (last_order_at);          -- for "called N days ago" query
create index on call_log (manager_id, called_at); -- manager's daily call list
create index on orders (client_id);
```

---

## Installation

```bash
# Bootstrap
npx create-next-app@latest dara-crm --typescript --tailwind --app --src-dir --import-alias "@/*"
cd dara-crm

# Supabase
npm install @supabase/supabase-js @supabase/ssr

# shadcn/ui init
npx shadcn@latest init
npx shadcn@latest add button input form table dialog sheet badge combobox select

# TanStack Table (pulled in by shadcn data-table)
npm install @tanstack/react-table

# Forms + validation
npm install react-hook-form zod @hookform/resolvers

# Excel import
npm install xlsx

# OpenRouter (via OpenAI SDK)
npm install openai

# Lightweight client-side fetching (for polling)
npm install swr

# Type generation from Supabase schema
npm install -D supabase
npx supabase gen types typescript --project-id <project-id> > src/types/database.ts
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| UI library | shadcn/ui | Ant Design | AntD: 1MB+ bundle, Emotion conflicts with RSC streaming, Chinese-first design language |
| UI library | shadcn/ui | MUI | MUI: CSS-in-JS runtime, forces `use client` on too many components |
| Data fetching | RSC + SWR | TanStack Query | TanStack: 13KB overhead, mutation management overkill for 3-5 users with Server Actions |
| Auth | Supabase Auth (email) | NextAuth.js | NextAuth adds complexity for simple email/password; Supabase Auth is already in the stack |
| Excel | xlsx (SheetJS) | exceljs | exceljs: slower, larger bundle; xlsx handles malformed files better (relevant for Агбис export) |
| AI SDK | openai SDK → OpenRouter | Vercel AI SDK | Vercel AI SDK: good for streaming chat UI, overkill for one-shot WhatsApp message generation |
| Validation | zod | yup | zod: better TypeScript inference, already in project (Telegram Bot), same syntax for RHF resolver |

---

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-only, never expose to client
OPENROUTER_API_KEY=sk-or-...
```

**Rule R8 from CLAUDE.md:** All `process.env.X` values must be `.trim()`ed before use in API calls.

---

## Sources

- Next.js App Router data fetching: https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/migrating/app-router-migration.mdx (Context7, HIGH confidence)
- Supabase SSR auth for Next.js: https://supabase.com/docs/guides/auth/server-side/nextjs (official docs, HIGH confidence)
- Supabase RLS patterns: https://supabase.com/docs/guides/local-development/testing/pgtap-extended (Context7, HIGH confidence)
- shadcn/ui DataTable + Combobox: https://ui.shadcn.com/docs/components/data-table (Context7, HIGH confidence)
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart (official, MEDIUM confidence — verified OpenAI SDK compatibility)
- xlsx / SheetJS Next.js: https://docs.sheetjs.com/docs/demos/static/nextjs/ (official, MEDIUM confidence)
- Server Actions vs API Routes: https://github.com/vercel/next.js/discussions/72919 (community, MEDIUM confidence)
- react-hook-form + zod + Server Actions: https://markus.oberlehner.net/blog/using-react-hook-form-with-react-19-use-action-state-and-next-js-15-app-router (MEDIUM confidence)
- TanStack Query vs SWR 2025: https://refine.dev/blog/react-query-vs-tanstack-query-vs-swr-2025/ (MEDIUM confidence)
