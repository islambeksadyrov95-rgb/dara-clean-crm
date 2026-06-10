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
const supabaseAnonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const adminId = 'bc804460-8b47-4d0e-a9c1-63fd1e66850b';
  const email = 'admin@dara.clean';
  const newPassword = 'DaraClean2026!';

  console.log(`Resetting password for user ${email} (ID: ${adminId}) to: ${newPassword}...`);
  
  const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    adminId,
    { password: newPassword }
  );

  if (updateError) {
    console.error('Password reset failed:', updateError.message);
    return;
  }

  console.log('Password successfully reset in Supabase!');

  // Проверим, можем ли мы войти теперь
  console.log(`Verifying sign in with the new password...`);
  const { data: loginData, error: loginError } = await supabaseAnon.auth.signInWithPassword({
    email,
    password: newPassword
  });

  if (loginError) {
    console.error('Verification failed. Still cannot sign in:', loginError.message);
  } else {
    console.log('Verification SUCCESSFUL! User can now sign in.');
  }
}

main();
