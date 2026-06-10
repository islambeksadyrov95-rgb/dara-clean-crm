const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('./.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    env[key] = val;
  }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing env vars in .env.local');
  process.exit(1);
}

const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:77474515333Islam!@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`;

async function run() {
  console.log('Connecting to PostgreSQL database via pooler...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected! Running migrations...');

    // 1. Add columns to profiles
    console.log('Adding columns to public.profiles...');
    await client.query(`
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sip_extension text;
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    `);

    // 2. Add column to call_logs
    console.log('Adding audio_url column to public.call_logs...');
    await client.query(`
      ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS audio_url text;
    `);

    console.log('Database migrations completed successfully!');
    await client.end();
  } catch (err) {
    console.error('Database migration failed:', err.message);
    process.exit(1);
  }

  console.log('Initializing Supabase client to configure storage...');
  const supabase = createClient(supabaseUrl.trim(), serviceRoleKey.trim());

  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;

    const exists = buckets.some(b => b.name === 'call-recordings');
    if (!exists) {
      console.log('Creating public storage bucket "call-recordings"...');
      const { error: createError } = await supabase.storage.createBucket('call-recordings', {
        public: true,
        allowedMimeTypes: ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/ogg'],
      });
      if (createError) throw createError;
      console.log('Bucket "call-recordings" created successfully!');
    } else {
      console.log('Bucket "call-recordings" already exists.');
    }
  } catch (err) {
    console.error('Storage bucket initialization failed:', err.message);
  }
}

run();
