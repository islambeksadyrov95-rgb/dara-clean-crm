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

const url = `${env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/`;
const options = {
  method: 'GET',
  headers: {
    'apikey': env['SUPABASE_SERVICE_ROLE_KEY'],
    'Authorization': `Bearer ${env['SUPABASE_SERVICE_ROLE_KEY']}`,
    'Accept': 'application/openapi+json'
  }
};

console.log("Sending GET request with service role key...");
const req = https.request(url, options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(data);
      const salesPlansPaths = parsed.paths && parsed.paths['/sales_plans'];
      const definitions = parsed.definitions && parsed.definitions.sales_plans;
      console.log("sales_plans paths spec:", JSON.stringify(salesPlansPaths, null, 2));
      console.log("sales_plans properties in cache:", JSON.stringify(definitions ? definitions.properties : null, null, 2));
    } catch (e) {
      console.log("Raw Response:", data.slice(0, 1000));
    }
  });
});

req.on('error', (err) => {
  console.error("Request error:", err.message);
});

req.end();
