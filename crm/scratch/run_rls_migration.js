const https = require('https');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local file not found at:', envPath);
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

const secret = env['SUPABASE_SERVICE_ROLE_KEY'];
if (!secret) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not defined in .env.local');
  process.exit(1);
}

const sql = `
  -- 1. Update RLS policies for public.clients to allow select for all authenticated users
  drop policy if exists "authenticated can select clients" on public.clients;
  create policy "authenticated can select clients"
    on public.clients for select to authenticated
    using (true);

  -- 2. Update RLS policies for public.orders to allow select for all authenticated users
  drop policy if exists "admin can select all orders" on public.orders;
  drop policy if exists "manager can select own orders" on public.orders;
  drop policy if exists "authenticated can select orders" on public.orders;
  create policy "authenticated can select orders"
    on public.orders for select to authenticated
    using (true);

  -- 3. Update RLS policies for public.call_logs to allow select for all authenticated users
  drop policy if exists "admin can select all call_logs" on public.call_logs;
  drop policy if exists "manager can select own call_logs" on public.call_logs;
  drop policy if exists "authenticated can select call_logs" on public.call_logs;
  create policy "authenticated can select call_logs"
    on public.call_logs for select to authenticated
    using (true);
`;

const encodedSql = encodeURIComponent(sql.trim());
const initialUrl = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${secret.trim()}&sql=${encodedSql}`;

function fetchUrl(url) {
  console.log('Sending request to:', url.split('?')[0] + '?secret=***');
  https.get(url, (res) => {
    console.log('Status Code:', res.statusCode);
    
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log('Redirecting to:', res.headers.location);
      fetchUrl(res.headers.location);
      return;
    }
    
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      console.log('Response Body:', data);
    });
  }).on('error', (err) => {
    console.error('Request error:', err.message);
  });
}

fetchUrl(initialUrl);
