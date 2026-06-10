const { Client } = require('pg');

async function test(host, port) {
  const connectionString = `postgresql://postgres:mFy6e-n5UujVN9@${host}:${port}/postgres?options=-c%20project%3Dotcktbyxaptxjnkxyili`;
  console.log(`Probing: host=${host}:${port} with project option...`);
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 4000
  });
  try {
    await client.connect();
    console.log(`✅ SUCCESS! Connected with project option to host: ${host}`);
    const res = await client.query('SELECT 1 as test;');
    console.log('Query result:', res.rows);
    await client.end();
    return true;
  } catch (e) {
    console.log(`❌ Failed: ${e.message}`);
    return false;
  }
}

async function run() {
  const regions = [
    'ap-southeast-2', // Sydney
    'eu-central-1',   // Frankfurt
    'us-east-1'       // Virginia
  ];
  
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    for (const port of [6543, 5432]) {
      const ok = await test(host, port);
      if (ok) {
        console.log(`🎉 Found working connection via options: host=${host}:${port}`);
        return;
      }
    }
  }
  console.log('All probes failed.');
}

run();
