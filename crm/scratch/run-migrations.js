const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260608000001_broadcasts.sql');
console.log('Reading migration from:', migrationPath);

let sql = '';
try {
  sql = fs.readFileSync(migrationPath, 'utf8');
} catch (e) {
  console.error('Failed to read migration file:', e.message);
  process.exit(1);
}

const connectionString = 'postgresql://postgres.otcktbyxaptxjnkxyili:77474515333Islam!@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Database connected. Applying migration...');
    await client.query(sql);
    console.log('✅ Migration applied successfully!');
  } catch (err) {
    console.error('❌ Error applying migration:', err.message);
  } finally {
    await client.end();
  }
}

run();
