# Walking Skeleton — Dara Clean CRM

Recorded: Phase 1 (Auth + Project Setup)
Status: Foundation complete

## Framework
- **Next.js 15** — App Router (not Pages Router)
- **TypeScript** strict mode
- **Tailwind CSS v4** + **shadcn/ui** (Neutral base, CSS variables)

## Package Manager
- **npm** (package-lock.json in crm/)

## Authentication
- **Supabase Auth** — email/password, no self-registration
- **@supabase/ssr** — browser client (createBrowserClient) and server client (createServerClient)
- **Middleware** — getUser() on every request, never getSession()
- **Roles** — stored in user_metadata.role ("manager" | "admin"), no separate profiles table

## Directory Layout
```
crm/
  app/
    (auth)/login/page.tsx       — public login form
    (protected)/layout.tsx      — reads session, enforces auth
    (protected)/queue/page.tsx  — manager + admin
    (protected)/import/page.tsx — admin only
  lib/supabase/
    client.ts                   — browser client
    server.ts                   — server client
  middleware.ts                 — route protection + role redirects
  components/ui/               — shadcn/ui primitives
```

## Routing Decisions
- Route groups: (auth) for public, (protected) for auth-required
- Manager default: /queue
- Admin default: /queue
- Unauthorized access: redirect to role default
- All auth pages: force-dynamic

## Database
- **Supabase PostgreSQL** (RLS in Phase 2)
- Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

## Key Constraints
- Never use getSession() in middleware — use getUser()
- force-dynamic on all auth-touching pages
- Client component login form (not Server Action) for MVP
