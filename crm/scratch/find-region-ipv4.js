const { Client } = require('pg');

const regions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-east-1',
  'ap-south-1',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-north-1',
  'me-central-1',
  'sa-east-1',
  'af-south-1',
  'ap-southeast-3'
];

async function run() {
  const user = 'postgres.otcktbyxaptxjnkxyili';
  const pass = 'mFy6e-n5UujVN9';
  
  for (const r of regions) {
    const host = `aws-0-${r}.pooler.supabase.com`;
    for (const port of [6543, 5432]) {
      const connectionString = `postgresql://${user}:${pass}@${host}:${port}/postgres`;
      console.log(`Probing AWS region ${r} (host: ${host}) on port ${port}...`);
      
      const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 2000
      });
      
      try {
        await client.connect();
        console.log(`\n🎉 SUCCESS! Connected to AWS region: ${r} (${host}) on port ${port}\n`);
        const res = await client.query('SELECT 1 as test;');
        console.log('Query result:', res.rows);
        await client.end();
        return;
      } catch (e) {
        if (e.message.includes('tenant/user') && e.message.includes('not found')) {
          // Продолжаем
        } else {
          console.log(`  Error for ${r} on port ${port}: ${e.message}`);
        }
      }
    }
  }
  console.log('All AWS regions failed.');
}

run();
