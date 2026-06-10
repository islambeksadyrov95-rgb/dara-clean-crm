const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function test() {
  console.log("--- Fetching profiles ---");
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
  if (pErr) console.error("profiles error:", pErr);
  else console.log("profiles:", profiles);

  console.log("\n--- Fetching sales_plans ---");
  const { data: plans, error: sErr } = await supabase.from('sales_plans').select('*');
  if (sErr) console.error("sales_plans error:", sErr);
  else console.log("sales_plans:", plans);
}

test();
