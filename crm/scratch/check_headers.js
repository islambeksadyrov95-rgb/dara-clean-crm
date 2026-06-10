const https = require('https');

const url = 'https://otcktbyxaptxjnkxyili.supabase.co';

https.get(url, (res) => {
  console.log("Headers:", res.headers);
}).on('error', (err) => {
  console.error("Error:", err.message);
});
