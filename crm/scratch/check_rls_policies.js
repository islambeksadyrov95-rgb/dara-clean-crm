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
      SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'clients';
    `);
    
    console.log('Current RLS policies for table "clients":');
    console.log(JSON.stringify(res.rows, null, 2));
    
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

check();
