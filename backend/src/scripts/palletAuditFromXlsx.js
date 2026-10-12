// Конвертер файла сверки (xlsx) в scans.json для palletAudit.js.
// Использование: node src/scripts/palletAuditFromXlsx.js <файл.xlsx> [out.json]
// Колонка A — штрихкоды коробок, колонка B — подпись адреса паллета (в любой строке листа).
// Пишет ВСЕ строки как есть, без чистки: дубли и обрезанные сканы должны быть видны в отчёте.
const ExcelJS = require('exceljs');
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3] || require('path').join(__dirname, 'palletAuditScans.json');

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const out = {};
  const bad = [];
  let total = 0;

  for (const ws of wb.worksheets) {
    const codes = [];
    let sig = null;
    ws.eachRow((row, i) => {
      const cell = v => (v == null ? '' : String(v.text ?? v.result ?? v).trim());
      const a = cell(row.getCell(1).value);
      const b = cell(row.getCell(2).value);
      if (b) sig = b;
      if (!a) return;
      if (!/^\d+$/.test(a) || (a.length !== 9 && a.length !== 17)) bad.push({ sheet: ws.name, row: i, val: a });
      codes.push(a);
    });
    if (!codes.length) continue;
    total += codes.length;
    // ключ листа: "ИмяЛиста::подпись" — palletAudit.js читает адрес из подписи, иначе из имени
    out[`${ws.name.trim()}::${sig || ''}`] = codes;
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('листов:', Object.keys(out).length, '| строк:', total, '→', OUT);
  if (bad.length) {
    console.log('строки с непохожим на ШК значением (пойдут в «нет в базе»):');
    bad.forEach(b => console.log('  лист', JSON.stringify(b.sheet), 'строка', b.row, '→', JSON.stringify(b.val)));
  }
})().catch(e => { console.error(e); process.exit(1); });
