const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join('D:\\Mind map\\Dara Clean\\crm', 'Мотивация отдела продаж - повторные - ИСПРАВЛЕНО_V2.xlsx');

function readYear() {
  const wb = XLSX.readFile(filePath);
  const settingsSheet = wb.Sheets['Настройки'];
  if (settingsSheet) {
    console.log("--- settings sheet rows ---");
    const data = XLSX.utils.sheet_to_json(settingsSheet, { header: 1 });
    data.slice(0, 15).forEach((row, i) => {
      console.log(`Row ${i + 1}:`, row);
    });
  }
}
readYear();
