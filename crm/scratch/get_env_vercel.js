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

// Запрашиваем env с прод Vercel
const url = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${encodeURIComponent(secret.trim())}&sql=env`;

console.log('Fetching env from Vercel production...');
https.get(url, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Vercel env keys and values:');
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log('Raw output:', data);
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
