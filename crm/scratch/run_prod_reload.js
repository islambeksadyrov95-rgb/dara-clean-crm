const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const secret = env['SUPABASE_SERVICE_ROLE_KEY'];

// SQL-запрос для сброса кэша схемы PostgREST
const sql = "NOTIFY pgrst, 'reload schema';";

const encodedSql = encodeURIComponent(sql.trim());
const url = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${secret.trim()}&sql=${encodedSql}`;

console.log('Sending schema reload to Vercel production...');
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${data}`);
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
