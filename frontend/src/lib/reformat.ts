import type { ReformatColumn } from './api';

export const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

export function isAllowedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cellToText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDate(v);
  return String(v);
}

export interface ParsedFile {
  fileName: string;
  raw: string[][];
}

export async function parseSpreadsheet(file: File): Promise<ParsedFile> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('The file has no readable sheets');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  return {
    fileName: file.name,
    raw: raw.map((r) => (r || []).map(cellToText)),
  };
}

const HEADER_HINTS =
  /(code|sku|description|name|qty|quantity|brand|category|price|cost|barcode|serial|retail|group|model|date|time|number|id|no\.|product|unit|status|type|classification|coverage|technician|ship|repair|invoice|po|created|received)/i;

export function detectHeaderRow(raw: string[][]): number {
  const maxScan = Math.min(raw.length, 12);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < maxScan; i++) {
    const cells = (raw[i] || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (cells.length === 0) continue;
    const named = cells.filter((c) => HEADER_HINTS.test(c)).length;
    const numeric = cells.filter((c) => !isNaN(Number(c))).length;
    const uniqueRatio = new Set(cells).size / cells.length;
    const score = named * 4 + cells.length * 2 - numeric * 2 + (uniqueRatio === 1 ? 3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function buildHeaders(raw: string[][], headerIdx: number): string[] {
  const row = raw[headerIdx] || [];
  const seen = new Map<string, number>();
  return row.map((h, i) => {
    const base = String(h ?? '').trim() || `Column_${i + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export function dataRowCount(raw: string[][], headerIdx: number): number {
  return raw.slice(headerIdx + 1).filter((r) => (r || []).some((c) => String(c ?? '').trim() !== '')).length;
}

export function transformRows(
  raw: string[][],
  headerIdx: number,
  columns: ReformatColumn[]
): string[][] {
  const headers = buildHeaders(raw, headerIdx);
  const colIdx = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!colIdx.has(h)) colIdx.set(h, i);
  });
  const data = raw
    .slice(headerIdx + 1)
    .filter((r) => (r || []).some((c) => String(c ?? '').trim() !== ''));
  return data.map((row) =>
    columns.map((col) => {
      if (col.source) {
        const idx = colIdx.get(col.source);
        return idx !== undefined && idx < row.length ? String(row[idx] ?? '') : '';
      }
      return col.constant;
    })
  );
}

function escapeCsv(v: string): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: string[][], includeHeader: boolean): string {
  const lines: string[] = [];
  if (includeHeader) lines.push(headers.map(escapeCsv).join(','));
  for (const row of rows) lines.push(row.map(escapeCsv).join(','));
  return lines.join('\n');
}

function escapeHtml(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toHtmlTable(headers: string[], rows: string[][], includeHeader: boolean): string {
  const cell = (v: string, tag: 'td' | 'th') => `<${tag}>${escapeHtml(v)}</${tag}>`;
  let html = '<table>';
  if (includeHeader) html += `<tr>${headers.map((h) => cell(h, 'th')).join('')}</tr>`;
  for (const row of rows) html += `<tr>${row.map((c) => cell(c, 'td')).join('')}</tr>`;
  return html + '</table>';
}

export async function copySpreadsheet(headers: string[], rows: string[][], includeHeader: boolean): Promise<void> {
  const plain = toCsv(headers, rows, includeHeader);
  if (typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([toHtmlTable(headers, rows, includeHeader)], { type: 'text/html' }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(plain);
  }
}

export function downloadBlob(content: Blob | string, filename: string): void {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadXlsx(headers: string[], rows: string[][], filename: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename);
}

export function downloadCsv(headers: string[], rows: string[][], filename: string): void {
  downloadBlob('\uFEFF' + toCsv(headers, rows, true), filename);
}

export type SmartFilterOp =
  | 'contains'
  | 'not contains'
  | 'equals'
  | 'not equals'
  | 'starts with'
  | 'ends with'
  | 'is empty'
  | 'is not empty'
  | '>'
  | '<'
  | '>='
  | '<=';

export const FILTER_OP_GROUPS: { label: string; ops: SmartFilterOp[] }[] = [
  { label: 'Text', ops: ['contains', 'not contains', 'equals', 'not equals', 'starts with', 'ends with'] },
  { label: 'Empty / not empty', ops: ['is empty', 'is not empty'] },
  { label: 'Number', ops: ['>', '<', '>=', '<='] },
];

export interface SmartFilterRule {
  column: string;
  op: SmartFilterOp;
  value: string;
}

function compareValues(a: string, b: string, op: '>' | '<' | '>=' | '<='): boolean {
  const na = parseFloat(a.replace(/[,₱P$]/g, ''));
  const nb = parseFloat(b.replace(/[,₱P$]/g, ''));
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    switch (op) {
      case '>': return na > nb;
      case '<': return na < nb;
      case '>=': return na >= nb;
      case '<=': return na <= nb;
    }
  }
  switch (op) {
    case '>': return a.localeCompare(b) > 0;
    case '<': return a.localeCompare(b) < 0;
    case '>=': return a.localeCompare(b) >= 0;
    case '<=': return a.localeCompare(b) <= 0;
  }
}

export function matchesFilter(row: string[], headers: string[], rule: SmartFilterRule): boolean {
  const idx = headers.indexOf(rule.column);
  if (idx === -1) return true;
  const cell = String(row[idx] ?? '');
  const needle = rule.value.trim();
  const text = cell.toLocaleLowerCase();
  const query = needle.toLocaleLowerCase();
  switch (rule.op) {
    case 'contains': return text.includes(query);
    case 'not contains': return !text.includes(query);
    case 'equals': return text === query;
    case 'not equals': return text !== query;
    case 'starts with': return text.startsWith(query);
    case 'ends with': return text.endsWith(query);
    case 'is empty': return text.trim() === '';
    case 'is not empty': return text.trim() !== '';
    case '>':
    case '<':
    case '>=':
    case '<=': return compareValues(cell, needle, rule.op);
  }
}

export function filterRows(
  rows: string[][],
  headers: string[],
  filters: SmartFilterRule[],
  mode: 'and' | 'or'
): { row: string[]; index: number }[] {
  if (filters.length === 0) return rows.map((row, index) => ({ row, index }));
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const results = filters.map((f) => matchesFilter(row, headers, f));
      return mode === 'and' ? results.every(Boolean) : results.some(Boolean);
    });
}

export function uniqueColumnValues(rows: string[][], colIndex: number, limit = 100): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const v = String(row[colIndex] ?? '').trim();
    if (v === '' || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export interface SortRule {
  column: string;
  dir: 'asc' | 'desc';
}

function compareCell(a: unknown, b: unknown): number {
  const ta = String(a ?? '').trim();
  const tb = String(b ?? '').trim();
  if (ta === '' && tb === '') return 0;
  if (ta === '') return 1;
  if (tb === '') return -1;
  const na = parseFloat(ta.replace(/[,₱P$]/g, ''));
  const nb = parseFloat(tb.replace(/[,₱P$]/g, ''));
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return ta.toLocaleLowerCase().localeCompare(tb.toLocaleLowerCase());
}

export function sortRows(
  displayRows: { row: string[]; index: number }[],
  headers: string[],
  rules: SortRule[]
): { row: string[]; index: number }[] {
  if (rules.length === 0) return displayRows;
  return [...displayRows].sort((a, b) => {
    for (const rule of rules) {
      const idx = headers.indexOf(rule.column);
      if (idx === -1) continue;
      const aEmpty = String(a.row[idx] ?? '').trim() === '';
      const bEmpty = String(b.row[idx] ?? '').trim() === '';
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      const c = compareCell(a.row[idx], b.row[idx]);
      if (c !== 0) return rule.dir === 'asc' ? c : -c;
    }
    return 0;
  });
}

export type PivotAgg = 'sum' | 'count' | 'average' | 'min' | 'max';

export const PIVOT_AGG_LABELS: Record<PivotAgg, string> = {
  sum: 'Sum',
  count: 'Count',
  average: 'Average',
  min: 'Min',
  max: 'Max',
};

export interface PivotValue {
  column: string;
  agg: PivotAgg;
}

export interface PivotConfig {
  rowFields: string[];
  colField: string | null;
  values: PivotValue[];
  filterField: string | null;
  filterValue: string;
}

export interface PivotResult {
  headers: string[];
  rowLabels: string[];
  topHeaders: { label: string; span: number }[];
  colHeaders: string[];
  rows: (string | null)[][];
  groupCount: number;
  colCount: number;
}

function parseNumber(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/[,₱P$]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

export function valueLabel(v: PivotValue): string {
  return `${PIVOT_AGG_LABELS[v.agg]} of ${v.column}`;
}

export function columnLooksNumeric(rows: string[][], headers: string[], column: string): boolean {
  const idx = headers.indexOf(column);
  if (idx === -1) return false;
  let numeric = 0;
  let total = 0;
  for (const row of rows.slice(0, 50)) {
    const v = String(row[idx] ?? '').trim();
    if (v === '') continue;
    total++;
    if (!Number.isNaN(parseFloat(v.replace(/[,₱P$]/g, '')))) numeric++;
  }
  return total > 0 && numeric / total >= 0.7;
}

function aggregate(values: (number | null)[], agg: PivotAgg): string | null {
  const nums = values.filter((v): v is number => v !== null);
  switch (agg) {
    case 'count': return String(values.length);
    case 'sum': return nums.length === 0 ? null : fmtNumber(nums.reduce((s, v) => s + v, 0));
    case 'average': return nums.length === 0 ? null : fmtNumber(nums.reduce((s, v) => s + v, 0) / nums.length);
    case 'min': return nums.length === 0 ? null : fmtNumber(Math.min(...nums));
    case 'max': return nums.length === 0 ? null : fmtNumber(Math.max(...nums));
  }
}

export function buildPivot(
  rows: string[][],
  headers: string[],
  config: PivotConfig
): PivotResult {
  const idx = (col: string) => headers.indexOf(col);
  const filterCol = config.filterField;
  const source =
    filterCol && config.filterValue !== ''
      ? rows.filter((r) => String(r[idx(filterCol)] ?? '') === config.filterValue)
      : rows;
  const rowKey = (row: string[]) => config.rowFields.map((f) => String(row[idx(f)] ?? '')).join('\u0001');
  const colKey = (row: string[]) => (config.colField ? String(row[idx(config.colField)] ?? '') : '');

  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  const bucket = new Map<string, (number | null)[]>();

  for (const row of source) {
    const rk = rowKey(row);
    const ck = colKey(row);
    rowKeys.add(rk);
    colKeys.add(ck);
    for (const v of config.values) {
      const key = `${rk}\u0002${ck}\u0002${v.agg}\u0002${v.column}`;
      let arr = bucket.get(key);
      if (!arr) {
        arr = [];
        bucket.set(key, arr);
      }
      arr.push(parseNumber(row[idx(v.column)]));
    }
  }

  const sortedRowKeys = [...rowKeys].sort((a, b) => {
    const av = a.split('\u0001');
    const bv = b.split('\u0001');
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const c = compareCell(av[i], bv[i]);
      if (c !== 0) return c;
    }
    return 0;
  });
  const sortedColKeys = [...colKeys].sort((a, b) => compareCell(a, b));

  const label = (v: PivotValue) => valueLabel(v);

  const headersOut: string[] = [];
  if (config.rowFields.length > 0) headersOut.push(...config.rowFields);
  if (config.colField) {
    for (const ck of sortedColKeys) {
      for (const v of config.values) headersOut.push(`${ck} · ${label(v)}`);
      for (const v of config.values) headersOut.push(`Total ${label(v)}`);
    }
  } else {
    for (const v of config.values) headersOut.push(label(v));
  }

  const rowsOut: (string | null)[][] = sortedRowKeys.map((rk) => {
    const cells = config.rowFields.length > 0 ? rk.split('\u0001') : [];
    const out: (string | null)[] = [...cells];
    if (config.colField) {
      for (const ck of sortedColKeys) {
        for (const v of config.values) {
          out.push(aggregate(bucket.get(`${rk}\u0002${ck}\u0002${v.agg}\u0002${v.column}`) ?? [], v.agg));
        }
        for (const v of config.values) {
          const colVals = sortedColKeys.flatMap((k) => bucket.get(`${rk}\u0002${k}\u0002${v.agg}\u0002${v.column}`) ?? []);
          out.push(aggregate(colVals, v.agg));
        }
      }
    } else {
      for (const v of config.values) {
        const colVals = sortedColKeys.flatMap((k) => bucket.get(`${rk}\u0002${k}\u0002${v.agg}\u0002${v.column}`) ?? []);
        out.push(aggregate(colVals, v.agg));
      }
    }
    return out;
  });

  const grand: (string | null)[] = config.rowFields.length > 0 ? ['Grand Total', ...new Array(config.rowFields.length - 1).fill('')] : [];
  if (config.colField) {
    for (const ck of sortedColKeys) {
      for (const v of config.values) {
        const vals = sortedRowKeys.flatMap((rk) => bucket.get(`${rk}\u0002${ck}\u0002${v.agg}\u0002${v.column}`) ?? []);
        grand.push(aggregate(vals, v.agg));
      }
      for (const v of config.values) {
        const vals = sortedRowKeys.flatMap((rk) => sortedColKeys.flatMap((k) => bucket.get(`${rk}\u0002${k}\u0002${v.agg}\u0002${v.column}`) ?? []));
        grand.push(aggregate(vals, v.agg));
      }
    }
  } else {
    for (const v of config.values) {
      const vals = sortedRowKeys.flatMap((rk) => bucket.get(`${rk}\u0002\u0002${v.agg}\u0002${v.column}`) ?? []);
      grand.push(aggregate(vals, v.agg));
    }
  }
  rowsOut.push(grand);

  const topHeaders = config.colField
    ? config.values.map((v) => ({ label: label(v), span: sortedColKeys.length + 1 }))
    : [];
  const colHeaders = config.colField
    ? config.values.flatMap(() => [...sortedColKeys, 'Total'])
    : [];

  return {
    headers: headersOut,
    rowLabels: config.rowFields,
    topHeaders,
    colHeaders,
    rows: rowsOut,
    groupCount: sortedRowKeys.length,
    colCount: sortedColKeys.length,
  };
}
