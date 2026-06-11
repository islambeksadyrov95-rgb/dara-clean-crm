// Applies pending SQL migrations from supabase/migrations/ to the live Supabase
// project via the Management API (no DB password needed — uses SUPABASE_ACCESS_TOKEN).
// Tracks applied files in public._migrations. Idempotent: applied files are skipped.
//
// Usage:
//   npm run db:migrate              — apply pending migrations in filename order
//   npm run db:migrate -- --baseline — mark ALL current files as applied WITHOUT running
//                                      (one-time bootstrap when DB already matches files)
//   npm run db:migrate -- --status   — list applied/pending, change nothing
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const PROJECT_REF = 'otcktbyxaptxjnkxyili'
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const env = readFileSync(join(ROOT, '.env.local'), 'utf8')
  const match = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)
  if (!match) throw new Error('SUPABASE_ACCESS_TOKEN not found in env or .env.local')
  return match[1].trim()
}

async function runSql(token, query) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`)
  }
  return res.json()
}

async function ensureLedger(token) {
  await runSql(
    token,
    `create table if not exists public._migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     );
     alter table public._migrations enable row level security;`
  )
}

async function getApplied(token) {
  const rows = await runSql(token, 'select name from public._migrations order by name')
  return new Set(rows.map((r) => r.name))
}

function getLocalMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

async function markApplied(token, name) {
  await runSql(
    token,
    `insert into public._migrations (name) values ('${name.replaceAll("'", "''")}')
     on conflict (name) do nothing`
  )
}

async function main() {
  const mode = process.argv.includes('--baseline')
    ? 'baseline'
    : process.argv.includes('--status')
      ? 'status'
      : 'apply'
  const token = loadAccessToken()
  await ensureLedger(token)
  const applied = await getApplied(token)
  const local = getLocalMigrations()
  const pending = local.filter((f) => !applied.has(f))

  if (mode === 'status') {
    local.forEach((f) => console.log(`${applied.has(f) ? 'applied' : 'PENDING'}  ${f}`))
    console.log(`\n${applied.size} applied, ${pending.length} pending`)
    return
  }

  if (mode === 'baseline') {
    for (const f of pending) {
      await markApplied(token, f)
      console.log(`baseline  ${f}`)
    }
    console.log(`Baseline complete: ${pending.length} file(s) marked as applied (not executed).`)
    return
  }

  if (pending.length === 0) {
    console.log('No pending migrations.')
    return
  }
  for (const f of pending) {
    console.log(`applying  ${f} ...`)
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    await runSql(token, sql)
    await markApplied(token, f)
    console.log(`applied   ${f}`)
  }
  console.log(`Done: ${pending.length} migration(s) applied. Run: npm run gen:types`)
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message)
  process.exit(1)
})
