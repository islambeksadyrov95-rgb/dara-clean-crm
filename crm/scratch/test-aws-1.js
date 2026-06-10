const { Client } = require('pg');

async function test(user, host, port, db, pass) {
  const connectionString = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
  console.log(`Probing: user=${user}, host=${host}:${port}, db=${db}...`);
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000
  });
  try {
    await client.connect();
    console.log(`\n🎉 SUCCESS! Connected with user: ${user}, db: ${db}!\n`);
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
  const host = 'aws-1-ap-southeast-2.pooler.supabase.com';
  const pass = 'mFy6e-n5UujVN9';
  
  const combinations = [
    { user: 'postgres', db: 'postgres.otcktbyxaptxjnkxyili' },
    { user: 'postgres', db: 'otcktbyxaptxjnkxyili' }
  ];
  
  for (const combo of combinations) {
    for (const port of [6543, 5432]) {
      const ok = await test(combo.user, host, port, combo.db, pass);
      if (ok) {
        console.log(`🎉 Found working connection: user=${combo.user}, db=${combo.db}, port=${port}`);
        return;
      }
    }
  }
  console.log('All combinations failed.');
}

run();
