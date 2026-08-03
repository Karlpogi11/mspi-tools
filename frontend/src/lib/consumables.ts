export interface ConsumableMaster {
  id: number;
  part_number: string;
  description: string;
  category: string;
  expires: string;
  unit: string;
}

export interface ConsumableEntry {
  key: string;
  partNumber: string;
  code: string;
  dateReceived: string;
  qty: number;
}

export interface LabelBlock {
  line1: string;
  line2: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function extractDateCode(scan: string): number | null {
  const m = String(scan ?? '').match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

export function productionDateFromCode(scan: string): string {
  const code = extractDateCode(scan);
  if (!code) return '';
  const year = 2000 + Math.floor(code / 100);
  const week = code % 100;
  if (week < 1 || week > 53) return '';
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const prod = new Date(Date.UTC(year, 0, 4 - dow + (week - 1) * 7 + 3));
  return formatDate(prod);
}

function addMonths(d: Date, months: number): Date {
  const v = new Date(d.getTime());
  const day = v.getUTCDate();
  v.setUTCMonth(v.getUTCMonth() + months);
  if (v.getUTCDate() < day) v.setUTCDate(0);
  return v;
}

export function expiryDateFromProduction(prod: string, part: ConsumableMaster | undefined): string {
  if (!prod || !part || part.expires !== 'Y') return '';
  if (!ISO_RE.test(prod)) return '';
  const [y, m, d] = prod.split('-').map(Number);
  return formatDate(addMonths(new Date(Date.UTC(y, m - 1, d)), 18));
}

export function masterLookup(partNumber: string, master: ConsumableMaster[]): ConsumableMaster | undefined {
  const p = String(partNumber ?? '').trim();
  return master.find((m) => m.part_number === p);
}

function isPlainRow(row: unknown[]): boolean {
  return row.some((c) => String(c ?? '').trim() !== '');
}

function toIsoDate(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (ISO_RE.test(s)) return s;
  if (/^\d{1,6}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? '' : formatDate(d);
  }
  const d = new Date(s.includes('/') ? s.replace(/\//g, '-') : s);
  return Number.isNaN(d.getTime()) ? '' : formatDate(d);
}

export interface ParsedReceivingRow {
  partNumber: string;
  code: string;
  dateReceived: string;
  qty: number;
}

const isPartHeaderCell = (c: string): boolean => /^part\s*number(\W|$)/i.test(c) && c.length <= 24;
const isCodeHeaderCell = (c: string): boolean => /^9\s*d(\W|$)/i.test(c) || (/^code(\W|$)/i.test(c) && c.length <= 10) || c.toLowerCase() === 'scan';

export async function parseReceivingWorkbook(buf: ArrayBuffer): Promise<{ rows: ParsedReceivingRow[]; sheetName: string }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase().includes('receiving')) ??
    wb.SheetNames.find((n) => n.toLowerCase().includes('print')) ??
    wb.SheetNames[0];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });

  let headerRow = -1;
  let partIdx = -1;
  let codeIdx = -1;
  let dateIdx = -1;
  let qtyIdx = -1;
  for (let r = 0; r < raw.length; r++) {
    const row = raw[r].map((c) => String(c ?? '').trim());
    const p = row.findIndex((c) => isPartHeaderCell(c));
    if (p === -1) continue;
    const c = row.findIndex((cell, i) => i !== p && isCodeHeaderCell(cell));
    if (c === -1) continue;
    partIdx = p;
    codeIdx = c;
    dateIdx = row.findIndex((cell) => /date received/i.test(cell) || /received date/i.test(cell));
    qtyIdx = row.findIndex((cell) => cell.toLocaleLowerCase() === 'qty arrived' || cell.toLocaleLowerCase() === 'qty' || cell.toLocaleLowerCase() === 'quantity');
    headerRow = r;
    break;
  }
  if (headerRow === -1 || partIdx === -1) {
    throw new Error('Could not find the "Part Number" column in this file. Use the downloaded template.');
  }

  const rows: ParsedReceivingRow[] = [];
  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!isPlainRow(row)) continue;
    const partNumber = String(row[partIdx] ?? '').trim();
    if (!partNumber) continue;
    const code = codeIdx !== -1 ? String(row[codeIdx] ?? '').trim() : '';
    const dateReceived = dateIdx !== -1 ? toIsoDate(row[dateIdx]) : '';
    const qtyRaw = qtyIdx !== -1 ? row[qtyIdx] : undefined;
    const qtyParsed = parseInt(String(qtyRaw ?? '').replace(/[^\d.-]/g, ''), 10);
    const qty = Number.isNaN(qtyParsed) || qtyParsed <= 0 ? 1 : qtyParsed;
    rows.push({ partNumber, code, dateReceived, qty });
  }
  return { rows, sheetName };
}

export async function parseMasterWorkbook(buf: ArrayBuffer): Promise<{ part_number: string; description: string; category: string; expires: string; unit: string }[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase().includes('master')) ??
    wb.SheetNames.find((n) => n.toLowerCase().includes('part')) ??
    wb.SheetNames[0];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });

  let headerRow = -1;
  let partIdx = -1;
  let descIdx = -1;
  let catIdx = -1;
  let expIdx = -1;
  let unitIdx = -1;
  for (let r = 0; r < raw.length; r++) {
    const row = raw[r].map((c) => String(c ?? '').trim());
    const p = row.findIndex((c) => isPartHeaderCell(c));
    if (p === -1) continue;
    partIdx = p;
    descIdx = row.findIndex((c) => c.toLocaleLowerCase().includes('description'));
    catIdx = row.findIndex((c) => c.toLocaleLowerCase().startsWith('category'));
    expIdx = row.findIndex((c) => c.toLocaleLowerCase().startsWith('expires'));
    unitIdx = row.findIndex((c) => c.toLocaleLowerCase() === 'unit');
    headerRow = r;
    break;
  }
  if (headerRow === -1 || partIdx === -1) throw new Error('Could not find the "Part Number" column. Use the Master List sheet or the downloaded template.');

  const seen = new Set<string>();
  const out: { part_number: string; description: string; category: string; expires: string; unit: string }[] = [];
  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!isPlainRow(row)) continue;
    const partNumber = String(row[partIdx] ?? '').trim();
    const description = descIdx !== -1 ? String(row[descIdx] ?? '').trim() : '';
    if (!partNumber || !description) continue;
    if (seen.has(partNumber)) continue;
    seen.add(partNumber);
    const category = catIdx !== -1 ? String(row[catIdx] ?? '').trim() : 'Other';
    const expires = expIdx !== -1 && String(row[expIdx] ?? '').trim().toUpperCase() === 'N' ? 'N' : 'Y';
    const unit = unitIdx !== -1 && String(row[unitIdx] ?? '').trim() ? String(row[unitIdx] ?? '').trim() : 'pcs';
    out.push({ part_number: partNumber, description, category, expires, unit });
  }
  return out;
}

export function buildLabels(entries: ConsumableEntry[], master: ConsumableMaster[]): LabelBlock[] {
  const out: LabelBlock[] = [];
  for (const e of entries) {
    const pn = String(e.partNumber ?? '').trim();
    if (!pn) continue;
    const part = masterLookup(pn, master);
    const description = part?.description || '(not in master list)';
    const prod = productionDateFromCode(e.code);
    const exp = expiryDateFromProduction(prod, part);
    const count = Math.max(1, Math.floor(Number(e.qty)) || 1);
    for (let i = 0; i < count; i++) {
      out.push({ line1: `${pn} - ${description}`, line2: exp ? `Exp.: ${exp}` : '' });
    }
  }
  return out;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}