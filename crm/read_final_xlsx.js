const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'Мотивация отдела продаж - повторные - ФИНАЛ.xlsx');

function readXlsx() {
  const wb = XLSX.readFile(filePath);
  console.log("Sheets in Excel file:");
  wb.SheetNames.forEach(name => {
    console.log(`  - ${name}`);
  });

  const plansSheet = wb.Sheets['Планы по категориям'];
  if (plansSheet) {
    console.log("\n--- Plans Sheet structure ---");
    for (let r = 1; r <= 20; r++) {
      let line = `${r}: `;
      for (let c = 65; c <= 89; c++) { // A to Y
        const col = String.fromCharCode(c);
        const cell = plansSheet[`${col}${r}`];
        line += `${col}:[${cell ? cell.v : ''}] `;
      }
      console.log(line);
    }
  }
}

readXlsx();
