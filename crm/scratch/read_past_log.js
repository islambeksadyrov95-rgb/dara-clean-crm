const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\User\\.gemini\\antigravity\\brain';

async function main() {
  try {
    if (!fs.existsSync(brainDir)) {
      console.log('Brain directory does not exist:', brainDir);
      return;
    }

    const conversations = fs.readdirSync(brainDir);
    console.log(`Found ${conversations.length} conversation folders.`);

    for (const convId of conversations) {
      // Игнорируем не UUID папки
      if (convId.length < 30) continue;

      const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(logPath)) {
        console.log(`Searching in conversation ${convId}...`);
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes('wazzup') && (line.includes('key') || line.includes('api') || line.includes('bearer') || line.match(/[a-f0-9]{32}/i))) {
            // Ищем API ключи (32-значные хэши) или упоминания
            console.log(`[Conv: ${convId}][Line ${index}]:`);
            // Попробуем вывести кусок текста, содержащий ключевые слова
            try {
              const parsed = JSON.parse(line);
              const text = parsed.content || JSON.stringify(parsed.tool_calls) || '';
              const matches = text.match(/[a-f0-9]{32}/gi);
              if (matches) {
                console.log('  Possible API Keys found:', matches);
              }
              // Выведем первые 200 символов текста вокруг слова wazzup
              const wazzupIdx = text.toLowerCase().indexOf('wazzup');
              const start = Math.max(0, wazzupIdx - 50);
              const end = Math.min(text.length, wazzupIdx + 150);
              console.log(`  Snippet: ...${text.substring(start, end)}...`);
            } catch (e) {
              // Если строка не валидный JSON
              console.log(`  Raw snippet: ${line.substring(0, 200)}`);
            }
          }
        });
      }
    }
  } catch (err) {
    console.error('Error reading logs:', err);
  }
}

main();
