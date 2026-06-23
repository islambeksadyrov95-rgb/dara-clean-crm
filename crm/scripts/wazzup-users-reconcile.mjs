// Reconciles Wazzup "employees" (v3/users) in BOTH accounts to exactly the active
// CRM profiles — one record per person, stable id (= profiles.id), no channel suffix.
//
// Deletes everything that is not an active profile id: channel-suffix duplicates
// (`<id>_<channelId>`), deleted/test accounts, and stray probes. Then upserts the
// canonical set so each real employee exists once per account with the right name.
// Idempotent — safe to re-run anytime junk reappears.
//
// Usage:
//   node scripts/wazzup-users-reconcile.mjs --dry-run   — preview, change nothing
//   node scripts/wazzup-users-reconcile.mjs             — apply (delete + upsert)
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const USERS_ENDPOINT = 'https://api.wazzup24.com/v3/users'

function env(key) {
  if (process.env[key]) return process.env[key]
  const file = readFileSync(join(ROOT, '.env.local'), 'utf8')
  const m = file.match(new RegExp(`^${key}=(.+)$`, 'm'))
  if (!m) throw new Error(`${key} not found in env or .env.local`)
  return m[1].trim().replace(/^"|"$/g, '')
}

async function fetchActiveProfiles() {
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${url}/rest/v1/profiles?select=id,email,name,role,is_active`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  const rows = await res.json()
  return rows
    .filter((p) => p.is_active !== false)
    .map((p) => ({ id: p.id, name: p.name || (p.email ? p.email.split('@')[0] : 'Менеджер') }))
}

async function listWazzupUsers(apiKey) {
  const all = []
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${USERS_ENDPOINT}?offset=${offset}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`Wazzup GET users ${res.status}: ${await res.text()}`)
    const page = await res.json()
    const rows = Array.isArray(page) ? page : page.data || []
    all.push(...rows)
    if (rows.length < 100) break
  }
  return all
}

async function deleteWazzupUser(apiKey, id) {
  const res = await fetch(`${USERS_ENDPOINT}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`Wazzup DELETE ${id} -> ${res.status}: ${await res.text()}`)
}

async function upsertWazzupUsers(apiKey, users) {
  const res = await fetch(USERS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(users),
  })
  if (!res.ok) throw new Error(`Wazzup POST users -> ${res.status}: ${await res.text()}`)
}

async function reconcileAccount(label, apiKey, canonical) {
  const canonicalIds = new Set(canonical.map((u) => u.id))
  const existing = await listWazzupUsers(apiKey)
  const toDelete = existing.filter((u) => !canonicalIds.has(u.id))

  console.log(`\n[${label}] existing=${existing.length}, canonical=${canonical.length}, to delete=${toDelete.length}`)
  for (const u of toDelete) console.log(`   - delete ${u.name} (${u.id})`)

  if (DRY_RUN) {
    console.log(`   (dry-run) would upsert ${canonical.length} canonical users`)
    return
  }
  for (const u of toDelete) await deleteWazzupUser(apiKey, u.id)
  await upsertWazzupUsers(apiKey, canonical)

  const after = await listWazzupUsers(apiKey)
  console.log(`   done -> now ${after.length} users: ${after.map((u) => u.name).join(', ')}`)
}

async function main() {
  const canonical = await fetchActiveProfiles()
  console.log(`Canonical CRM employees (${canonical.length}): ${canonical.map((u) => `${u.name}`).join(', ')}`)
  if (canonical.length === 0) throw new Error('Refusing to reconcile: 0 active profiles (would wipe Wazzup users)')

  await reconcileAccount('account-1 / 705', env('WAZZUP_API_KEY'), canonical)
  await reconcileAccount('account-2 / 707', env('WAZZUP_API_KEY_2'), canonical)
  console.log(DRY_RUN ? '\nDRY-RUN complete (nothing changed).' : '\nReconcile complete.')
}

main().catch((err) => {
  console.error('Reconcile failed:', err.message)
  process.exit(1)
})
