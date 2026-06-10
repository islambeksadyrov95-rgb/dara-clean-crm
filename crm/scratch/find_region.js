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
  'sa-east-1'
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
        // Ожидаемая ошибка, если регион не тот
        console.log(`  Not this region (tenant not found)`);
      } else {
        console.log(`  Connection error: ${err.message}`);
      }
    }
  }
}

findRegion();
