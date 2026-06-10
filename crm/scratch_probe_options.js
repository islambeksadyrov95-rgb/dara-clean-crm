const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260608000001_broadcasts.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

async function run() {
  const region = 'ap-southeast-2'; // Сидней
  const host = `aws-0-${region}.pooler.supabase.com`;
  
  // Пробуем порт 6543 с опцией project
  const connectionString = `postgresql://postgres:mFy6e-n5UujVN9@${host}:6543/postgres?options=-c%20project%3Dotcktbyxaptxjnkxyili`;
  
  console.log(`Connecting to pooler on ${host} with options...`);
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ SUCCESS! Connected via pooler with options.');
    console.log('Applying migration...');
    await client.query(sql);
    console.log('✅ SQL Applied!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
