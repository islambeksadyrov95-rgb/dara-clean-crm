const fs = require('fs');

const logPath = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\777c2931-e61b-4848-9a5b-5aea12eb493d\\.system_generated\\logs\\transcript.jsonl';

async function main() {
  if (!fs.existsSync(logPath)) {
    console.log('Log file not found');
    return;
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
        console.log(`\n[USER]: ${parsed.content}`);
      }
    } catch {}
  });
}

main();
