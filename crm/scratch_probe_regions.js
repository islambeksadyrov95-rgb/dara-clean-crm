const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260608000001_broadcasts.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const regions = [
  'eu-central-1', // Frankfurt
  'eu-west-1',    // Ireland
  'eu-west-2',    // London
  'eu-west-3',    // Paris
  'us-east-1',    // N. Virginia
  'us-east-2',    // Ohio
  'us-west-1',    // N. California
  'us-west-2',    // Oregon
  'ap-southeast-1', // Singapore
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'ap-south-1',     // Mumbai
  'sa-east-1',      // Sao Paulo
  'ca-central-1'    // Canada
];

async function probeAndRun() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    // Используем порт 6543 (пулер для транзакций/сессий) или 5432
    const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:6543/postgres`;
    
    console.log(`Probing region ${region} (host: ${host})...`);
    
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 4000,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      console.log(`✅ SUCCESS! Connected to region ${region}`);
      
      console.log('Applying SQL migration...');
      await client.query(sql);
      console.log('✅ SQL Migration applied successfully!');
      
      await client.end();
      return; // Выходим из цикла
    } catch (e) {
      console.log(`❌ Failed: ${e.message}`);
    }
  }
  console.log('Could not connect to any region.');
}

probeAndRun();
