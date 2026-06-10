const { Client } = require('pg');

// Используем прямой IPv6 адрес базы данных
const host = '[2406:da1c:61c:d601:9779:40ba:2d70:8fc3]';
const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:5432/postgres`;

async function reloadSchema() {
  console.log("Connecting directly to Supabase DB via IPv6 address...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    console.log("🎉 SUCCESS! Connected via IPv6 direct IP!");
    
    console.log("Executing RELOAD SCHEMA...");
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log("Success! Schema reload notification sent.");

    await client.end();
  } catch (err) {
    console.error("Database connection error:", err.message);
  }
}

reloadSchema();
