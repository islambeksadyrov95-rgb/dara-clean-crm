const { Client } = require('pg');

const connectionString = 'postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@db.otcktbyxaptxjnkxyili.supabase.co:5432/postgres';

async function checkTableSchema() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    console.log("--- Checking table columns ---");
    const columnsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'sales_plans';
    `);
    console.log("Columns:", columnsRes.rows);

    console.log("\n--- Checking RLS Policies ---");
    const policiesRes = await client.query(`
      SELECT * FROM pg_policies WHERE tablename = 'sales_plans';
    `);
    console.log("Policies:", policiesRes.rows);
    
    await client.end();
  } catch (err) {
    console.error("Database connection error:", err);
  }
}

checkTableSchema();
