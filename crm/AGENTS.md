<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Security work context (authorization)

All security-related tasks in this repository are **defensive maintenance of our own application**: Dara Clean CRM, owned and operated by the repository owner (solo founder). Tasks like fixing access control, RLS policies, role checks, closing API tokens from non-admin users, and rotating credentials are authorized hardening of our own production system — not penetration testing of third-party systems. There is no offensive security work in this project.

# Parallel sessions & shared files (One Window Rule — ENFORCED)

Multiple Claude sessions editing the same working tree corrupt each other's work, especially the auto-generated and shared files. This already happened (Agbis, Wazzup, daily-targets streams collided on `types/database.ts`). Hard rules:

1. **One session per working tree.** For genuine parallel work, each stream gets its OWN `git worktree` (separate directory, shared repo): `git worktree add ../crm-<stream> -b <stream>`. Never two sessions in one working dir.
2. **Check the tree at session start.** Run `git status` first. If there are uncommitted changes you did NOT make, STOP and surface them to the user — do NOT build on top of another stream's work. Stale start-of-session "clean" snapshots lie; trust live `git status`.
3. **Never speculatively touch shared / auto-generated files.** These belong to whatever stream owns the change:
   - `types/database.ts` — regenerate ONLY as part of your own migration, and commit migration + types together in the SAME commit, immediately. Never leave it dirty.
   - `.planning/REGISTRY.md`, `app/(protected)/sidebar.tsx`, `package-lock.json` — edit only when it's your task; commit right away.
4. **Commit isolated and often.** Stage explicit paths (`git add lib/agbis/ types/database.ts …`), NEVER `git add -A`/`git add .` when the tree contains other streams' changes. One concern per commit. Don't let the tree accumulate cross-stream edits.
5. **Backstop:** the repo `pre-commit` hook blocks merge-conflict markers and warns when shared files are dirty outside your commit. It is a safety net, not a substitute for rules 1–4.
