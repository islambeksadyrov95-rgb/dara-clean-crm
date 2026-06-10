const { Client } = require('pg');

const gcpRegions = [
  'us-east4',
  'us-west2',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'asia-northeast1',
  'asia-southeast1',
  'australia-southeast1',
  'us-central1',
  'southamerica-east1',
  'europe-west9',
  'asia-southeast2',
  'asia-south1',
  'europe-west6'
];

async function run() {
  const user = 'postgres.otcktbyxaptxjnkxyili';
  const pass = 'mFy6e-n5UujVN9';
  
  for (const r of gcpRegions) {
    const host = `gcp-${r}.pooler.supabase.com`;
    for (const port of [6543, 5432]) {
      const connectionString = `postgresql://${user}:${pass}@${host}:${port}/postgres`;
      console.log(`Probing GCP region ${r} (host: ${host}) on port ${port}...`);
      
      const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 3000
      });
      
      try {
        await client.connect();
        console.log(`\n🎉 SUCCESS! Connected to GCP region: ${r} (${host}) on port ${port}\n`);
        const res = await client.query('SELECT 1 as test;');
        console.log('Query result:', res.rows);
        await client.end();
        return;
      } catch (e) {
        if (e.message.includes('tenant/user') && e.message.includes('not found')) {
          console.log(`  Not this region (tenant not found)`);
        } else {
          console.log(`  Error: ${e.message}`);
        }
      }
    }
  }
  console.log('All GCP regions failed.');
}

run();
