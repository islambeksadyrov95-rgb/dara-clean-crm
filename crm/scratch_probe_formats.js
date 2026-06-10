const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260608000001_broadcasts.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const regions = ['ap-southeast-2', 'ap-southeast-1', 'eu-central-1'];
const formats = [
  // 1. Стандартный новый формат Supabase: user = postgres.[ref], db = postgres
  (r) => ({
    user: 'postgres.otcktbyxaptxjnkxyili',
    pass: 'mFy6e-n5UujVN9',
    host: `aws-0-${r}.pooler.supabase.com`,
    port: 6543,
    database: 'postgres'
  }),
  // 2. Формат с db = [ref]
  (r) => ({
    user: 'postgres',
    pass: 'mFy6e-n5UujVN9',
    host: `aws-0-${r}.pooler.supabase.com`,
    port: 6543,
    database: 'postgres.otcktbyxaptxjnkxyili'
  }),
  // 3. Формат с db = [ref] без postgres
  (r) => ({
    user: 'postgres',
    pass: 'mFy6e-n5UujVN9',
    host: `aws-0-${r}.pooler.supabase.com`,
    port: 6543,
    database: 'otcktbyxaptxjnkxyili'
  }),
  // 4. Порт 5432
  (r) => ({
    user: 'postgres.otcktbyxaptxjnkxyili',
    pass: 'mFy6e-n5UujVN9',
    host: `aws-0-${r}.pooler.supabase.com`,
    port: 5432,
    database: 'postgres'
  })
];

async function run() {
  for (const region of regions) {
    for (let i = 0; i < formats.length; i++) {
      const config = formats[i](region);
      console.log(`Testing Region: ${region}, Format: ${i + 1} (host: ${config.host}:${config.port}, db: ${config.database}, user: ${config.user})...`);
      
      const client = new Client({
        ...config,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 3000
      });
      
      try {
        await client.connect();
        console.log('✅ SUCCESS!');
        console.log('Applying migration...');
        await client.query(sql);
        console.log('✅ SQL Applied!');
        await client.end();
        return;
      } catch (e) {
        console.log(`❌ Failed: ${e.message}`);
      }
    }
  }
  console.log('All formats failed.');
}

run();
