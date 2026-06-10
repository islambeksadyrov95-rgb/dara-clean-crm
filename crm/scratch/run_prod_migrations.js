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
const url = `https://crm-roan-ten.vercel.app/api/run-migrations?secret=${secret.trim()}`;

console.log('Running remote migrations on Vercel production...');
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(data);
      console.log("Response Logs:", parsed.logs);
      if (parsed.success) {
        console.log("Success!");
      } else {
        console.log("Failed. Error:", parsed.error);
      }
    } catch (e) {
      console.log("Raw Response:", data);
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
