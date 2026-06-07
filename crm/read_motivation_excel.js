const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(process.cwd(), 'Мотивация отдела продаж - повторные - ФИНАЛ.xlsx');

try {
  console.log('Reading file:', filePath);
  const wb = XLSX.readFile(filePath);
  console.log('Sheets available:', wb.SheetNames);
  
  wb.SheetNames.forEach(sheetName => {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = wb.Sheets[sheetName];
    const rangeRef = sheet['!ref'];
    console.log('Range:', rangeRef);
    if (!rangeRef) return;
    
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    data.slice(0, 40).forEach((row, i) => {
      if (row.length > 0) {
        console.log(`Row ${i + 1}:`, row.slice(0, 12).map(cell => cell === undefined ? '' : cell));
      }
    });
  });
} catch (err) {
  console.error('Error reading excel:', err);
}
