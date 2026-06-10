const https = require('https');
const fs = require('fs');

const envPath = './.env.local';
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

const sql = `
  drop policy if exists "authenticated can select clients" on public.clients;
  create policy "authenticated can select clients" on public.clients for select to authenticated using (true);
`;

const encodedSql = encodeURIComponent(sql.trim());
const url = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${secret.trim()}&sql=${encodedSql}`;

console.log('Sending migration request to Vercel production...');

https.get(url, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Body:', data);
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
