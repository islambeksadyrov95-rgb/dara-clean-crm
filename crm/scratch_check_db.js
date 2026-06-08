const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = './.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
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
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  try {
    // Выведем список пользователей из auth.users
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    console.log('Auth Users:');
    users.forEach(u => {
      console.log(`ID: ${u.id}, Email: ${u.email}, Role in Metadata: ${u.user_metadata?.role}, RawMetadata:`, u.user_metadata);
    });
  } catch (err) {
    console.error('Error:', err);
  }
}

check();
