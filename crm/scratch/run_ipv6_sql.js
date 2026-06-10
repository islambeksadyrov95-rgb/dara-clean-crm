const { Client } = require('pg');

const ipv6Host = '[2406:da1c:61c:d601:9779:40ba:2d70:8fc3]';
const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${ipv6Host}:5432/postgres`;

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const sql = `
  -- 1. Update RLS policies for public.clients to allow select for all authenticated users
  drop policy if exists "authenticated can select clients" on public.clients;
  create policy "authenticated can select clients"
    on public.clients for select to authenticated
    using (true);

  -- 2. Update RLS policies for public.orders to allow select for all authenticated users
  drop policy if exists "admin can select all orders" on public.orders;
  drop policy if exists "manager can select own orders" on public.orders;
  drop policy if exists "authenticated can select orders" on public.orders;
  create policy "authenticated can select orders"
    on public.orders for select to authenticated
    using (true);

  -- 3. Update RLS policies for public.call_logs to allow select for all authenticated users
  drop policy if exists "admin can select all call_logs" on public.call_logs;
  drop policy if exists "manager can select own call_logs" on public.call_logs;
  drop policy if exists "authenticated can select call_logs" on public.call_logs;
  create policy "authenticated can select call_logs"
    on public.call_logs for select to authenticated
    using (true);
`;

async function run() {
  console.log('Connecting to Supabase Postgres via raw IPv6 address...');
  try {
    await client.connect();
    console.log('Connected successfully. Executing SQL...');
    const res = await client.query(sql);
    console.log('SQL executed successfully!');
    console.log('Result:', res);
  } catch (err) {
    console.error('Error executing SQL:', err.message);
  } finally {
    await client.end();
  }
}

run();
