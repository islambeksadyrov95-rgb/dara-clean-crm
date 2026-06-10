const { Client } = require('pg');

const regions = [
  'eu-central-1',
  'eu-west-3',
  'eu-west-2',
  'eu-west-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ca-central-1',
  'sa-east-1',
  'ap-south-1',
  'eu-central-2',
  'eu-north-1',
  'ap-east-1'
];

async function findRegion() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    // Пробуем порт 5432 (session pooler)
    const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:5432/postgres`;
    console.log(`Testing region: ${region} (${host}) on port 5432...`);
    
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000
    });

    try {
      await client.connect();
      console.log(`🎉 SUCCESS! Connected to region: ${region} on port 5432`);
      
      console.log("Executing RELOAD SCHEMA...");
      await client.query("NOTIFY pgrst, 'reload schema';");
      console.log("Success! Schema reloaded.");
      
      await client.end();
      break;
    } catch (err) {
      if (err.message.includes('tenant/user') && err.message.includes('not found')) {
        console.log(`  Not this region (tenant not found)`);
      } else {
        console.log(`  Error: ${err.message}`);
      }
    }
  }
}

findRegion();
