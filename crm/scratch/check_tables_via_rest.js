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
    // В Supabase мы можем запросить схему через OpenAPI спеку, если она доступна
    console.log('Querying Swagger/OpenAPI spec to find public tables...');
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      }
    });

    if (!response.ok) {
      console.log('PostgREST Root failed:', response.status, await response.text());
      return;
    }

    const data = await response.json();
    console.log('Paths available in REST API (Tables/Views):');
    const paths = Object.keys(data.paths || {});
    console.log(paths);

    // Если есть таблицы настроек или конфигурации, попробуем их прочесть
    const configPaths = paths.filter(p => p.includes('setting') || p.includes('config') || p.includes('integration') || p.includes('wazzup'));
    for (const p of configPaths) {
      const cleanPath = p.replace(/\//g, '');
      console.log(`\n--- Reading ${cleanPath} ---`);
      const { data: records, error } = await supabase.from(cleanPath).select('*');
      if (error) {
        console.error('Error:', error.message);
      } else {
        console.log(records);
      }
    }

  } catch (err) {
    console.error('Error:', err);
  }
}

main();
