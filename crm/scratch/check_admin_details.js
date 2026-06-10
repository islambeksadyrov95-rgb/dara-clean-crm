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
const supabaseServiceKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  try {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    const adminUser = users.find(u => u.email === 'admin@dara.clean');
    if (!adminUser) {
      console.log('User admin@dara.clean not found');
      return;
    }

    console.log('Detailed User Info for admin@dara.clean:');
    console.log(JSON.stringify(adminUser, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
