const { Client } = require('pg');

const regions = [
  'ap-south-1',
  'me-central-1',
  'eu-central-2',
  'eu-north-1',
  'ap-east-1',
  'ap-south-2',
  'me-south-1',
  'af-south-1'
];

async function findRegion() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:6543/postgres`;
    console.log(`Testing region: ${region} (${host})...`);
    
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });

    try {
      await client.connect();
      console.log(`🎉 SUCCESS! Connected to region: ${region}`);
      
      console.log("Executing RELOAD SCHEMA...");
      await client.query("NOTIFY pgrst, 'reload schema';");
      console.log("Success! Schema reloaded.");
      
      await client.end();
      break;
    } catch (err) {
      if (err.message.includes('tenant/user') && err.message.includes('not found')) {
        console.log(`  Not this region (tenant not found)`);
      } else {
        console.log(`  Connection error: ${err.message}`);
      }
    }
  }
}

findRegion();
