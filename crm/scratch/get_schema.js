const https = require('https');
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

const url = `${supabaseUrl}/rest/v1/?apikey=${serviceKey}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const schema = JSON.parse(data);
      console.log('Successfully fetched schema!');
      
      const rpcPaths = Object.keys(schema.paths || {})
        .filter(p => p.startsWith('/rpc/'));
      
      console.log('\nAvailable RPC functions:');
      console.log(rpcPaths);
      
    } catch (err) {
      console.error('Failed to parse schema JSON:', err.message);
      console.log('Response was:', data.slice(0, 1000));
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
