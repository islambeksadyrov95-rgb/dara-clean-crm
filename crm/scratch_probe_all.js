const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260608000001_broadcasts.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const regions = [
  'ap-southeast-2', // Sydney (частый выбор для Азии/Казахстана)
  'ap-southeast-1', // Singapore
  'ap-south-1',     // Mumbai
  'eu-central-1',   // Frankfurt
  'eu-west-1',      // Ireland
  'eu-west-2',      // London
  'us-east-1',      // N. Virginia
  'us-west-2',      // Oregon
  'ap-east-1',      // Hong Kong
  'me-central-1',   // UAE
  'ap-southeast-3'  // Jakarta
];

async function probeAndRun() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    // Пробуем порты 6543 и 5432
    for (const port of [6543, 5432]) {
      const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:${port}/postgres`;
      
      console.log(`Probing region ${region} (host: ${host}) on port ${port}...`);
      
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: 3000,
        ssl: { rejectUnauthorized: false }
      });
      
      try {
        await client.connect();
        console.log(`✅ SUCCESS! Connected to region ${region} on port ${port}`);
        
        console.log('Applying SQL migration...');
        await client.query(sql);
        console.log('✅ SQL Migration applied successfully!');
        
        await client.end();
        return; // Успешно применили, выходим
      } catch (e) {
        console.log(`❌ Failed: ${e.message}`);
      }
    }
  }
  console.log('Could not connect to any region/port.');
}

probeAndRun();
