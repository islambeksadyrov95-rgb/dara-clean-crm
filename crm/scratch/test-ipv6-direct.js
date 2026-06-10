const { Client } = require('pg');

async function run() {
  const host = '2406:da1c:61c:d601:9779:40ba:2d70:8fc3';
  const user = 'postgres.otcktbyxaptxjnkxyili';
  const pass = 'mFy6e-n5UujVN9';
  
  console.log(`Connecting directly to IPv6 host: [${host}]...`);
  
  const client = new Client({
    host: host,
    port: 5432,
    user: user,
    password: pass,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ SUCCESS! Connected directly to IPv6 address!');
    const res = await client.query('SELECT 1 as test;');
    console.log('Result:', res.rows);
    await client.end();
  } catch (e) {
    console.error('❌ Failed:', e.message);
  }
}

run();
