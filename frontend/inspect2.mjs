import XLSX from 'xlsx';
import fs from 'fs';

const buf = fs.readFileSync('/Users/karlgarcia/Downloads/REPTAT - All (1).xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

const pad = (n) => String(n).padStart(2, '0');
const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  return String(v);
};
const toText = raw.map((r) => (r || []).map(fmt));

function buildHeaders(headersRow) {
  const seen = new Map();
  return headersRow.map((h, i) => {
    const base = String(h ?? '').trim() || `Column_${i + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function transformRows(headerIdx, columns) {
  const headers = buildHeaders(toText[headerIdx]);
  const colIdx = new Map();
  headers.forEach((h, i) => { if (!colIdx.has(h)) colIdx.set(h, i); });
  const data = toText.slice(headerIdx + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  return data.map((row) => columns.map((col) => {
    if (col.source) {
      const idx = colIdx.get(col.source);
      return idx !== undefined && idx < row.length ? String(row[idx] ?? '') : '';
    }
    return col.constant;
  }));
}

const hIdx = 5;
const headers = buildHeaders(toText[hIdx]);
console.log('headers:');
console.log(headers.map((h, i) => `${i}: ${h}`).join('\n'));

const autoColumns = headers.map((h) => ({ name: h, source: h, constant: '' }));
const out = transformRows(hIdx, autoColumns);
console.log('\nfirst transformed row:');
console.log(out[0].map((v, i) => `${i}: ${v}`).join('\n'));
