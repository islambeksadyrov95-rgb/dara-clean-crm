const fs = require('fs');
const path = require('path');

const files = ['.env.vercel', '.env.vercel.production'];
files.forEach(f => {
  const envPath = path.join(__dirname, '../', f);
  if (!fs.existsSync(envPath)) {
    console.log(f + ' file not found');
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const keys = content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split('=')[0].trim());

  console.log('Available keys in ' + f + ':', keys);
});
