// Regenerates types/database.ts from the live Supabase schema.
// Wraps `npx supabase gen types` so SUPABASE_ACCESS_TOKEN is loaded from .env.local.
// Usage: npm run gen:types
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_REF = 'otcktbyxaptxjnkxyili'
const OUT_FILE = join(ROOT, 'types', 'database.ts')

function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const env = readFileSync(join(ROOT, '.env.local'), 'utf8')
  const match = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)
  if (!match) throw new Error('SUPABASE_ACCESS_TOKEN not found in env or .env.local')
  return match[1].trim()
}

// shell:true — Node 24 on Windows cannot spawn npx (.cmd) without a shell (EINVAL).
// Safe here: every argument is a fixed constant, no user input reaches the command line.
const output = execFileSync(
  'npx',
  ['-y', 'supabase', 'gen', 'types', 'typescript', `--project-id=${PROJECT_REF}`, '--schema=public'],
  {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: loadAccessToken() },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: true,
  }
)

if (!output.includes('export type Database')) {
  console.error('[gen-types] output does not look like generated types:\n' + output.slice(0, 400))
  process.exit(1)
}
writeFileSync(OUT_FILE, output)
console.log(`Wrote ${OUT_FILE} (${output.length} chars). Commit it together with the migration.`)
