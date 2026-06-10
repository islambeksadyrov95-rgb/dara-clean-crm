const { Client } = require('pg');

const host = 'aws-1-ap-southeast-2.pooler.supabase.com';

async function applyPolicies() {
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
    console.log('Connected to Database. Dropping old policies...');

    // Удаляем старые политики
    await client.query(`
      DROP POLICY IF EXISTS "authenticated can select clients" ON public.clients;
      DROP POLICY IF EXISTS "authenticated can update clients" ON public.clients;
      DROP POLICY IF EXISTS "authenticated can insert clients" ON public.clients;
      DROP POLICY IF EXISTS "admin can delete clients" ON public.clients;
    `);
    console.log('Old policies dropped.');

    // Создаем новые политики
    console.log('Creating new policies...');
    
    // SELECT
    await client.query(`
      CREATE POLICY "authenticated can select clients" ON public.clients 
      FOR SELECT TO authenticated USING (
        assigned_manager_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
    `);
    
    // UPDATE
    await client.query(`
      CREATE POLICY "authenticated can update clients" ON public.clients 
      FOR UPDATE TO authenticated USING (
        assigned_manager_id = auth.uid() 
        OR assigned_manager_id IS NULL 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      ) WITH CHECK (
        assigned_manager_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
    `);

    // INSERT
    await client.query(`
      CREATE POLICY "authenticated can insert clients" ON public.clients 
      FOR INSERT TO authenticated WITH CHECK (
        assigned_manager_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
    `);

    // DELETE
    await client.query(`
      CREATE POLICY "admin can delete clients" ON public.clients 
      FOR DELETE TO authenticated USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
    `);

    console.log('New RLS policies successfully applied!');
    
    // Выведем новые политики для подтверждения
    const res = await client.query(`
      SELECT schemaname, tablename, policyname, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'clients';
    `);
    console.log('Updated policies:');
    console.log(JSON.stringify(res.rows, null, 2));

    await client.end();
  } catch (err) {
    console.error('Error applying policies:', err.message);
  }
}

applyPolicies();
