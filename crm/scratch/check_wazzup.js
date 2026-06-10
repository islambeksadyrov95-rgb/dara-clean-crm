const apiKey = '1d1896704e8a4fa385703445d4943b56';

async function checkSecondWazzup() {
  console.log(`Checking SECOND WAZZUP_API_KEY: ${apiKey}...`);
  try {
    const response = await fetch('https://api.wazzup24.com/v3/channels', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response body:');
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(text);
    }
  } catch (error) {
    console.error('Request error:', error);
  }
}

checkSecondWazzup();
