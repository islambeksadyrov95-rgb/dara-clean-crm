const fs = require('fs');
const path = require('path');

function searchInDir(dir, query) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (file === 'node_modules' || file === '.next' || file === '.git' || file === 'venv' || file === '.venv') continue;
      
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        searchInDir(fullPath, query);
      } else {
        if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.sql') || file.endsWith('.toml') || file.endsWith('.md') || file.endsWith('.py') || file.endsWith('.env') || file.endsWith('.local')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes(query)) {
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (line.includes(query) && !line.includes('SUPABASE_SERVICE_ROLE_KEY') && !line.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
                console.log(`Found in ${fullPath}:${idx + 1}: ${line.trim()}`);
              }
            });
          }
        }
      }
    }
  } catch (e) {
    // Игнорируем ошибки доступа
  }
}

console.log('Searching for "postgresql://" or "postgres:" in d:\\Mind map\\Dara Clean...');
searchInDir('d:\\Mind map\\Dara Clean', 'postgresql://');
searchInDir('d:\\Mind map\\Dara Clean', 'postgres:');
console.log('Finished.');
