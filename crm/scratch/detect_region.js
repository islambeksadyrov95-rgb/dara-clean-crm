const { Client } = require('pg');

const regions = [
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'sa-east-1',
  'ca-central-1',
  'me-central-1'
];

async function check() {
  const user = 'postgres.otcktbyxaptxjnkxyili';
  const pass = 'mFy6e-n5UujVN9';
  const db = 'postgres';

  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    console.log(`Trying region ${region}...`);
    
    const client = new Client({
      host,
      port: 5432,
      database: db,
      user: user,
      password: pass,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });

    try {
      await client.connect();
      console.log(`\n>>> SUCCESS! Connected to region: ${region} (${host}) <<<\n`);
      
      // Выполним проверочный запрос
      const res = await client.query('SELECT version();');
      console.log('Postgres version:', res.rows[0].version);
      
      await client.end();
      return; // Прекращаем перебор
    } catch (err) {
      console.log(`Failed for ${region}: ${err.message}`);
    }
  }
  console.log('All regions failed.');
}

check();
