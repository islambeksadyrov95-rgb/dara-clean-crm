const { Client } = require('pg');

const host = 'aws-1-ap-southeast-2.pooler.supabase.com';

async function check() {
  const client = new Client({
    host,
    port: 5432,
    database: 'postgres',
    user: 'postgres.otcktbyxaptxjnkxyili',
    password: '77474515333Islam!',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'profiles';
    `);
    
    console.log('Profiles table columns:');
    console.log(res.rows);
    
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

check();
