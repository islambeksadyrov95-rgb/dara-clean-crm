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

const firstApiKey = '69c3898008814f949d6adb8ed09b5076';
const secondApiKey = '1d1896704e8a4fa385703445d4943b56';

const firstChannelId = '40843839-f38c-4ea2-8096-1b4c44fd6dce';
const secondChannelId = 'fa03f183-34e8-4c03-a1bb-c97cedbc6666';

async function main() {
  try {
    console.log('Fetching profiles from database...');
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, email');

    if (profilesError) throw profilesError;

    console.log(`Found ${profiles.length} profiles.`);

    const usersForFirstWazzup = [];
    const usersForSecondWazzup = [];
    const seenIds = new Set();

    profiles.forEach(p => {
      if (seenIds.has(p.id)) return;
      seenIds.add(p.id);

      const managerName = p.name || p.email?.split('@')[0] || 'Менеджер';
      
      usersForFirstWazzup.push({
        id: `${p.id}_${firstChannelId}`,
        name: managerName
      });
      
      usersForSecondWazzup.push({
        id: `${p.id}_${secondChannelId}`,
        name: managerName
      });
    });

    console.log('Users to sync with First Wazzup:', usersForFirstWazzup.length);
    console.log('Users to sync with Second Wazzup:', usersForSecondWazzup.length);

    console.log('\nSyncing users with FIRST Wazzup account (77057618170)...');
    const firstSyncRes = await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firstApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(usersForFirstWazzup),
    });
    console.log('First Wazzup sync status:', firstSyncRes.status, await firstSyncRes.text());

    console.log('\nSyncing users with SECOND Wazzup account (77078083636)...');
    const secondSyncRes = await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secondApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(usersForSecondWazzup),
    });
    console.log('Second Wazzup sync status:', secondSyncRes.status, await secondSyncRes.text());

    console.log('\nSynchronization completed successfully!');
  } catch (err) {
    console.error('Error during sync:', err);
  }
}

main();
