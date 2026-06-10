const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local file not found');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    env[key] = val;
  }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase URL or Service Role Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    persistSession: false
  }
});

const sql = `
  -- Test query
  SELECT 1 as test;
`;

async function run() {
  // Try different potential RPC function names
  const rpcNames = ['exec_sql', 'run_sql', 'execute_sql', 'sql'];
  
  for (const name of rpcNames) {
    console.log(`Trying RPC function: ${name}...`);
    try {
      const { data, error } = await supabase.rpc(name, { query: sql, sql: sql });
      if (error) {
        console.log(`RPC ${name} returned error:`, error.message);
      } else {
        console.log(`RPC ${name} succeeded! Result:`, data);
        return;
      }
    } catch (err) {
      console.log(`RPC ${name} exception:`, err.message);
    }
  }
  
  console.log('No RPC SQL function succeeded.');
}

run();
