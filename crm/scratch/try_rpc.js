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

async function tryRpc() {
  console.log("Trying custom RPC functions...");
  
  const rpcNames = ['exec_sql', 'run_sql', 'reload_schema', 'reload_postgrest_cache'];
  
  for (const name of rpcNames) {
    try {
      const { data, error } = await supabase.rpc(name, { query: "SELECT 1;" });
      console.log(`RPC '${name}' query response:`, { data, error });
    } catch (e) {
      console.log(`RPC '${name}' threw:`, e.message);
    }
  }
}

tryRpc();
