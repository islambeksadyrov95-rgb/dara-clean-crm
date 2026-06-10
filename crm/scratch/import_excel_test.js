const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const filePath = path.join('D:\\Mind map\\Dara Clean\\crm', 'Мотивация отдела продаж - повторные - ИСПРАВЛЕНО_V2.xlsx');

async function testImport() {
  console.log("--- Fetching profiles ---");
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, name, email, role').neq('role', 'admin');
  if (pErr) {
    console.error("profiles error:", pErr);
    return;
  }
  console.log("Found managers in DB:", profiles.map(p => ({ id: p.id, name: p.name, email: p.email })));

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets['Планы по категориям'];
  if (!sheet) {
    console.error("Sheet 'Планы по категориям' not found");
    return;
  }

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // Строка 5 (индекс 4) содержит имена менеджеров
  const nameRow = data[4];
  console.log("Row 5 names:", nameRow);

  // Определяем индексы колонок для каждого менеджера по категориям
  // Категории и их стартовые колонки (где Общий план):
  // Ковры: 1 (B)
  // Мебель: 5 (F)
  // Шторы: 9 (J)
  // Самовывоз: 13 (N)
  // Пледы: 17 (R)
  // Повторные: 21 (V)
  
  const categories = [
    { key: 'carpets', baseIdx: 1 },
    { key: 'furniture', baseIdx: 5 },
    { key: 'curtains', baseIdx: 9 },
    { key: 'dryClean', baseIdx: 13 },
    { key: 'blankets', baseIdx: 17 },
    { key: 'repeat', baseIdx: 21 }
  ];

  // Сопоставляем менеджеров из БД с колонками
  // Для каждого менеджера из БД найдем смещение от базовой колонки категории
  const managerMappings = [];
  
  profiles.forEach(profile => {
    const pName = profile.name.toLowerCase().trim();
    // Ищем в nameRow в районе первой категории (ковры, столбцы C, D, E - индексы 2, 3, 4)
    let offset = -1;
    for (let i = 2; i <= 4; i++) {
      if (nameRow[i] && nameRow[i].toLowerCase().trim() === pName) {
        offset = i - 1; // Смещение относительно базы (которая на индексе 1)
        break;
      }
    }
    
    // Если по имени не нашли, попробуем по email
    if (offset === -1) {
      const emailPrefix = profile.email.split('@')[0].toLowerCase();
      for (let i = 2; i <= 4; i++) {
        if (nameRow[i] && nameRow[i].toLowerCase().trim().includes(emailPrefix)) {
          offset = i - 1;
          break;
        }
      }
    }

    if (offset !== -1) {
      managerMappings.push({
        profile,
        offset
      });
      console.log(`Mapped DB manager '${profile.name}' to Excel column offset +${offset} (name in Excel: '${nameRow[1 + offset]}')`);
    } else {
      console.warn(`Could not map DB manager '${profile.name}' (${profile.email}) to Excel columns`);
    }
  });

  const year = 2026;
  const upsertData = [];

  // Строки 6-17 (индексы 5-16) соответствуют месяцам 1-12
  for (let monthVal = 1; monthVal <= 12; monthVal++) {
    const rowIdx = 4 + monthVal; // строка 6 = индекс 5
    const row = data[rowIdx];
    if (!row) continue;

    managerMappings.forEach(mapping => {
      const carpetsVal = Number(row[1 + mapping.offset]) || 0;
      const furnitureVal = Number(row[5 + mapping.offset]) || 0;
      const curtainsVal = Number(row[9 + mapping.offset]) || 0;
      const dryCleanVal = Number(row[13 + mapping.offset]) || 0;
      const blanketsVal = Number(row[17 + mapping.offset]) || 0;
      const repeatVal = Number(row[21 + mapping.offset]) || 0;

      upsertData.push({
        manager_id: mapping.profile.id,
        month: monthVal,
        year: year,
        carpets_target: carpetsVal,
        furniture_target: furnitureVal,
        curtains_target: curtainsVal,
        dry_clean_target: dryCleanVal,
        blankets_target: blanketsVal,
        repeat_target: repeatVal
      });
    });
  }

  console.log(`Parsed ${upsertData.length} plan records. Example:`, upsertData[0]);

  // Пробуем сделать upsert в БД
  console.log("Saving plans to database...");
  const { data: saveRes, error: saveErr } = await supabase
    .from('sales_plans')
    .upsert(upsertData, { onConflict: 'manager_id,month,year' });

  if (saveErr) {
    console.error("Error saving plans:", saveErr);
  } else {
    console.log("Successfully saved plans to DB!");
  }
}

testImport();
