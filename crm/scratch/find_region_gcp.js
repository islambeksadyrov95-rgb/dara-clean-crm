const { Client } = require('pg');

const hosts = [
  'gcp-europe-west3.pooler.supabase.com',
  'gcp-us-east1.pooler.supabase.com',
  'gcp-asia-southeast1.pooler.supabase.com',
  // Также попробуем без префиксов регионов, просто имя хоста Supabase с пулером
  'gcp-europe-west-3.pooler.supabase.com',
  'gcp-us-east-1.pooler.supabase.com'
];

async function findRegion() {
  for (const host of hosts) {
    const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:6543/postgres`;
    console.log(`Testing host: ${host}...`);
    
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000
    });

    try {
      await client.connect();
      console.log(`🎉 SUCCESS! Connected to host: ${host}`);
      
      console.log("Executing RELOAD SCHEMA...");
      await client.query("NOTIFY pgrst, 'reload schema';");
      console.log("Success! Schema reloaded.");
      
      await client.end();
      break;
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }
}

findRegion();
