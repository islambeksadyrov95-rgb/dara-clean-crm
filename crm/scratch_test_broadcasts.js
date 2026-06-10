const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Чтение .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseServiceKey = env['SUPABASE_SERVICE_ROLE_KEY'];

console.log('Supabase URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkDatabase() {
  console.log('\n--- Checking Database Tables ---');
  
  // 1. Проверяем clients
  const { data: clientsData, error: clientsError } = await supabase
    .from('clients')
    .select('*')
    .limit(1);
    
  if (clientsError) {
    console.error('❌ Table "clients" error:', clientsError.message);
  } else {
    console.log('✅ Table "clients" is accessible. Found rows:', clientsData.length);
  }

  // 2. Проверяем broadcast_templates
  const { data: tmplData, error: tmplError } = await supabase
    .from('broadcast_templates')
    .select('*')
    .limit(1);
    
  if (tmplError) {
    console.error('❌ Table "broadcast_templates" error:', tmplError.message);
  } else {
    console.log('✅ Table "broadcast_templates" is accessible. Found rows:', tmplData.length);
  }

  // 3. Проверяем broadcast_logs
  const { data: logData, error: logError } = await supabase
    .from('broadcast_logs')
    .select('*')
    .limit(1);
    
  if (logError) {
    console.error('❌ Table "broadcast_logs" error:', logError.message);
  } else {
    console.log('✅ Table "broadcast_logs" is accessible. Found rows:', logData.length);
  }
}

checkDatabase();
