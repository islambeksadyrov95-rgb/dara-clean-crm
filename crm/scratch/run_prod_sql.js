const https = require('https');
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

// SQL-запрос для проверки таблиц в public и поиска таблиц с настройками
const sql = `
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
`;

const encodedSql = encodeURIComponent(sql.trim());
const url = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${secret.trim()}&sql=${encodedSql}`;

console.log('Running SQL query on Vercel production...');
https.get(url, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Tables found:');
      if (json.success) {
        console.table(json.result);
      } else {
        console.error('SQL Error:', json.error);
      }
    } catch {
      console.log('Raw output:', data);
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
