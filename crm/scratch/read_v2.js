const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join('D:\\Mind map\\Dara Clean\\crm', 'Мотивация отдела продаж - повторные - ИСПРАВЛЕНО_V2.xlsx');

function readXlsx() {
  const wb = XLSX.readFile(filePath);
  console.log("Sheets in Excel file:");
  wb.SheetNames.forEach(name => {
    console.log(`  - ${name}`);
  });

  wb.SheetNames.forEach(name => {
    console.log(`\n--- Structure of sheet: ${name} ---`);
    const sheet = wb.Sheets[name];
    if (!sheet) return;
    
    // Выведем первые 25 строк и колонки A-Z
    for (let r = 1; r <= 25; r++) {
      let line = `${String(r).padStart(2)}: `;
      let hasVal = false;
      for (let c = 65; c <= 90; c++) { // A to Z
        const col = String.fromCharCode(c);
        const cell = sheet[`${col}${r}`];
        if (cell && cell.v !== undefined && cell.v !== null) {
          line += `${col}:[${cell.v}] `;
          hasVal = true;
        }
      }
      if (hasVal) {
        console.log(line);
      }
    }
  });
}

readXlsx();
