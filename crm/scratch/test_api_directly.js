const apiKey = '69c3898008814f949d6adb8ed09b5076';
const secondChannelId = '1d1896704e8a4fa385703445d4943b56';

async function testGlobalIframe(channelId) {
  console.log(`\nTesting global iframe for channelId: ${channelId}...`);
  
  const wazzupUserId = channelId ? `test_user_${channelId}` : `test_user_global`;
  
  // 1. Сначала синхронизируем юзера
  try {
    const syncRes = await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ id: wazzupUserId, name: 'Test Manager' }]),
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
          id: wazzupUserId,
          name: 'Test Manager',
        },
        scope: 'global',
        // Если передан конкретный канал, то мы должны передать activeChat с этим каналом
        // Wazzup API позволяет отфильтровать или задать активный чат
        activeChat: {
          channelId: channelId,
          chatId: ''
        }
      }),
    });

    console.log('Iframe status:', response.status);
    console.log('Iframe body:', await response.text());
  } catch (err) {
    console.error('Iframe error:', err);
  }
}

testGlobalIframe(secondChannelId);
