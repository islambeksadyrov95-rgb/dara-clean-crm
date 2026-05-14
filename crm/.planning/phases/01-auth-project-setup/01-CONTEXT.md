# Phase 1: Auth + Project Setup - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Next.js project scaffolding with Supabase Auth integration. Managers and admin can log in with email/password and access role-appropriate sections. Login page, middleware-based route protection, role-based redirects.

</domain>

<decisions>
## Implementation Decisions

### Project Structure
- App Router (not Pages Router)
- npm as package manager
- Tailwind CSS + shadcn/ui for styling
- `crm/` directory is the Next.js project root

### Authentication Flow
- User roles stored in `user_metadata.role` in Supabase Auth (no separate profiles table)
- Admin creates manager accounts manually in Supabase dashboard (no self-registration)
- `@supabase/ssr` + `middleware.ts` with `getUser()` for auth checks
- Minimal centered login form: email + password + logo

### Role-Based Access
- Manager default landing: `/queue`
- Admin default landing: `/queue`
- Unauthorized route access: silent redirect to role's default page

### Claude's Discretion
- Next.js version (latest stable)
- Specific shadcn/ui components to install initially
- File/folder organization within app/

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `crm/База Агбис.xlsx` — client data file for Phase 3 import
- `crm/Плановый расчет.xlsx` — financial planning data

### Established Patterns
- No existing Next.js code — greenfield project
- Existing dashboard/ uses vanilla JS (separate codebase, not related)

### Integration Points
- Supabase project needs to be created/configured externally
- Environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for Next.js + Supabase auth setup.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
