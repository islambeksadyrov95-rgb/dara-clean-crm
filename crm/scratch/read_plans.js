const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join('D:\\Mind map\\Dara Clean\\crm', 'Мотивация отдела продаж - повторные - ИСПРАВЛЕНО_V2.xlsx');

function readXlsx() {
  const wb = XLSX.readFile(filePath);
  console.log("ALL SHEETS:", wb.SheetNames);

  const plansSheet = wb.Sheets['Планы по категориям'];
  if (plansSheet) {
    console.log("\n--- Plans Sheet structure (first 30 rows) ---");
    const data = XLSX.utils.sheet_to_json(plansSheet, { header: 1 });
    data.slice(0, 30).forEach((row, i) => {
      console.log(`Row ${i + 1}:`, row.map(cell => cell === undefined ? '' : cell));
    });
  } else {
    console.log("No 'Планы по категориям' sheet found");
  }
}

readXlsx();
