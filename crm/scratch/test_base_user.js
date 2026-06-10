const apiKey = '69c3898008814f949d6adb8ed09b5076';
const baseUserId = 'bc804460-8b47-4d0e-a9c1-63fd1e66850b';

async function testBaseUser() {
  console.log(`\nTesting global iframe for baseUserId: ${baseUserId}...`);
  
  // 1. Синхронизируем юзера (хотя он уже должен быть синхронизирован)
  try {
    const syncRes = await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ id: baseUserId, name: 'admin' }]),
    });
    console.log('Sync status:', syncRes.status);
    console.log('Sync body:', await syncRes.text());
  } catch (err) {
    console.error('Sync error:', err);
  }

  // 2. Запрашиваем iframe
  try {
    const response = await fetch('https://api.wazzup24.com/v3/iframe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: {
          id: baseUserId,
          name: 'admin',
        },
        scope: 'global'
      }),
    });

    console.log('Iframe status:', response.status);
    const data = await response.json();
    console.log('Iframe URL:', data.url);
  } catch (err) {
    console.error('Iframe error:', err);
  }
}

testBaseUser();
