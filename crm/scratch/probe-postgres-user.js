const { Client } = require('pg');

async function test(user, host, port) {
  const connectionString = `postgresql://${user}:mFy6e-n5UujVN9@${host}:${port}/postgres`;
  console.log(`Probing: user=${user}, host=${host}:${port}...`);
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 4000
  });
  try {
    await client.connect();
    console.log(`✅ SUCCESS! Connected with user: ${user} to host: ${host}`);
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
    'ap-southeast-2',
    'eu-central-1',
    'us-east-1'
  ];
  
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    for (const port of [6543, 5432]) {
      const ok = await test('postgres', host, port);
      if (ok) {
        console.log(`🎉 Found working connection: user=postgres, host=${host}:${port}`);
        return;
      }
    }
  }
  console.log('All probes failed.');
}

run();
