import XLSX from 'xlsx';
import fs from 'fs';

const buf = fs.readFileSync('/Users/karlgarcia/Downloads/REPTAT - All (1).xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

console.log('total rows:', raw.length);
console.log('row widths:', raw.slice(0, 10).map((r, i) => `${i}: ${(r || []).length}`).join('\n'));

const pad = (n) => String(n).padStart(2, '0');
const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  return String(v);
};

for (let i = 0; i < Math.min(raw.length, 9); i++) {
  console.log(`row ${i}: ` + (raw[i] || []).map(fmt).slice(0, 22).join(' | '));
}
