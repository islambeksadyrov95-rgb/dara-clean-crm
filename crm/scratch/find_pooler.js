const { Client } = require('pg');

const regions = [
  'eu-central-1', // Frankfurt
  'eu-west-1',    // Ireland
  'eu-west-2',    // London
  'eu-west-3',    // Paris
  'eu-north-1',   // Stockholm
  'eu-central-2', // Zurich
  'eu-south-1',   // Milan
  'ap-south-1',   // Mumbai
  'ap-southeast-1',// Singapore
  'ap-southeast-2',// Sydney
  'ap-northeast-1',// Tokyo
  'ap-northeast-2',// Seoul
  'ap-northeast-3',// Osaka
  'us-east-1',    // N. Virginia
  'us-east-2',    // Ohio
  'us-west-1',    // N. California
  'us-west-2',    // Oregon
  'ca-central-1', // Canada Central
  'sa-east-1',    // Sao Paulo
  'me-central-1', // Dubai
  'af-south-1'    // Cape Town
];

async function probe() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:6543/postgres`;
    
    console.log(`Probing pooler in region ${region} (${host})...`);
    
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 3000,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      console.log(`\nSUCCESS! Connected to pooler in region: ${region}`);
      
      const res = await client.query('SELECT version();');
      console.log('Postgres version:', res.rows[0].version);
      
      await client.end();
      return host;
    } catch (err) {
      // Print failure message only if it's not a tenant error, to see actual connection issues
      if (err.message.includes('tenant/user')) {
        // Just print a dot for quick feedback on incorrect regions
        process.stdout.write('.');
      } else {
        console.log(`\nFailed for ${region}: ${err.message}`);
      }
    }
  }
  console.log('\nCould not connect to any pooler.');
  return null;
}

probe();
