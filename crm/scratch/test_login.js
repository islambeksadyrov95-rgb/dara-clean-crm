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
const supabaseAnonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const email = 'admin@dara.clean';
  const password = 'DaraClean2026!';

  console.log(`Attempting to sign in as ${email} with password: ${password}`);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error('Sign in failed:', error.message);
  } else {
    console.log('Sign in SUCCESSFUL!');
    console.log('User ID:', data.user.id);
    console.log('Session access_token length:', data.session.access_token.length);
  }
}

main();
