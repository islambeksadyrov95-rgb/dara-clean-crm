const { Client } = require('pg');

async function run() {
  const host = 'aws-0-ap-southeast-2.pooler.supabase.com';
  const user = 'postgres.otcktbyxaptxjnkxyili';
  const pass = 'mFy6e-n5UujVN9';
  
  for (const port of [6543, 5432]) {
    const connectionString = `postgresql://${user}:${pass}@${host}:${port}/postgres`;
    console.log(`Connecting to Sydney (${host}) on port ${port} with 15s timeout...`);
    
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000
    });
    
    try {
      await client.connect();
      console.log(`\n🎉 SUCCESS! Connected to Sydney on port ${port}!\n`);
      const res = await client.query('SELECT 1 as test;');
      console.log('Result:', res.rows);
      await client.end();
      return;
    } catch (e) {
      console.log(`❌ Failed on port ${port}: ${e.message}`);
    }
  }
}

run();
