const { Client } = require('pg');

const host = 'db.otcktbyxaptxjnkxyili.supabase.co';
const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:5432/postgres`;

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Successfully connected to database.');

    // 1. Посмотрим список пользователей в auth.users
    console.log('\n--- AUTH.USERS ---');
    const authRes = await client.query('SELECT id, email, phone, last_sign_in_at, created_at FROM auth.users;');
    console.table(authRes.rows);

    // 2. Посмотрим какие таблицы вообще есть в схеме public
    console.log('\n--- PUBLIC TABLES ---');
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log(tablesRes.rows.map(r => r.table_name).join(', '));

    // 3. Если есть таблицы пользователей/профилей в public, посмотрим их
    const userTables = tablesRes.rows.map(r => r.table_name).filter(name => name.includes('user') || name.includes('profile') || name.includes('employee') || name.includes('manager'));
    for (const table of userTables) {
      console.log(`\n--- PUBLIC.${table.toUpperCase()} ---`);
      try {
        const dataRes = await client.query(`SELECT * FROM public."${table}" LIMIT 10;`);
        console.table(dataRes.rows);
      } catch (e) {
        console.error(`Error reading table ${table}:`, e.message);
      }
    }

    await client.end();
  } catch (err) {
    console.error('Error during execution:', err);
  }
}

main();
