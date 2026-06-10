const { Client } = require('pg');

const connectionString = 'postgresql://postgres.otcktbyxaptxjnkxyili:77474515333Islam!@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

async function reloadSchema() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Supabase DB via Pooler!");
    
    console.log("Executing RELOAD SCHEMA...");
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log("Success! Schema reload notification sent.");

    console.log("Checking columns of sales_plans again...");
    const columnsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'sales_plans';
    `);
    console.log("Columns in DB:", columnsRes.rows.map(r => `${r.column_name} (${r.data_type})`));

    await client.end();
  } catch (err) {
    console.error("Database error:", err);
  }
}

reloadSchema();
