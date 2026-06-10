const fs = require('fs');

const envContent = fs.readFileSync('./.env.local', 'utf8');
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
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const sql = `
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'profiles';
`;

const encodedSql = encodeURIComponent(sql.trim());
const url = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${secret.trim()}&sql=${encodedSql}`;

async function run() {
  try {
    const res = await fetch(url);
    console.log('Status:', res.status);
    const data = await res.text();
    try {
      const json = JSON.parse(data);
      if (json.success) {
        console.table(json.result);
      } else {
        console.error('SQL Error:', json.error);
      }
    } catch {
      console.log('Raw output:', data);
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

run();
