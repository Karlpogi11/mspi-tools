export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toIsoDate(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (ISO_RE.test(s)) return s;
  if (/^\d{1,6}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const d = new Date(s.includes('/') ? s.replace(/\//g, '-') : s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isPlainRow(row: unknown[]): boolean {
  return row.some((c) => String(c ?? '').trim() !== '');
}

const isPartHeaderCell = (c: string): boolean => /^part\s*number(\W|$)/i.test(c) && c.length <= 24;
const isSerialHeaderCell = (c: string): boolean => /^serial(\W|$)/i.test(c);
const isRefHeaderCell = (c: string): boolean => /reference/i.test(c) || /^ref(\W|$)/i.test(c) || /\bar\b/i.test(c);
const isDateHeaderCell = (c: string): boolean => /^date(\W|$)/i.test(c);
const isDescHeaderCell = (c: string): boolean => c.toLowerCase().includes('description');
const isEeeHeaderCell = (c: string): boolean => /\beee\b/i.test(c);
const isSubHeaderCell = (c: string): boolean => /substitut/i.test(c);
const isSerializedHeaderCell = (c: string): boolean => /serializ/i.test(c);

async function sheetGrid(buf: ArrayBuffer): Promise<{ raw: unknown[][]; sheetName: string }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  return { raw, sheetName };
}

function findHeader(raw: unknown[][], required: (row: string[]) => { ok: boolean; idx: Record<string, number> }): { headerRow: number; idx: Record<string, number> } {
  for (let r = 0; r < raw.length; r++) {
    const row = raw[r].map((c) => String(c ?? '').trim());
    const found = required(row);
    if (found.ok) return { headerRow: r, idx: found.idx };
  }
  return { headerRow: -1, idx: {} };
}

export interface ParsedStockInRow { date: string; partNumber: string; serial: string }
export interface ParsedStockOutRow { date: string; serial: string; reference: string; partNumber: string }
export interface ParsedMasterRow { part_number: string; description: string; eee_code: string | null; substitute_part: string | null; serialized: string }

export async function parseStockInWorkbook(buf: ArrayBuffer): Promise<ParsedStockInRow[]> {
  const { raw } = await sheetGrid(buf);
  const { headerRow, idx } = findHeader(raw, (row) => {
    const p = row.findIndex(isPartHeaderCell);
    if (p === -1) return { ok: false, idx: {} as Record<string, number> };
    return {
      ok: true,
      idx: {
        part: p,
        serial: row.findIndex(isSerialHeaderCell),
        date: row.findIndex(isDateHeaderCell),
      },
    };
  });
  if (headerRow === -1) throw new Error('Could not find the "Part Number" column. Use the downloaded stock-in template.');
  const out: ParsedStockInRow[] = [];
  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!isPlainRow(row)) continue;
    const partNumber = String(row[idx.part] ?? '').trim();
    if (!partNumber) continue;
    out.push({
      date: idx.date !== -1 ? toIsoDate(row[idx.date]) : '',
      partNumber,
      serial: idx.serial !== -1 ? String(row[idx.serial] ?? '').trim().toUpperCase() : '',
    });
  }
  return out;
}

export async function parseStockOutWorkbook(buf: ArrayBuffer): Promise<ParsedStockOutRow[]> {
  const { raw } = await sheetGrid(buf);
  const { headerRow, idx } = findHeader(raw, (row) => {
    const s = row.findIndex(isSerialHeaderCell);
    if (s === -1) return { ok: false, idx: {} as Record<string, number> };
    return {
      ok: true,
      idx: {
        serial: s,
        date: row.findIndex(isDateHeaderCell),
        ref: row.findIndex(isRefHeaderCell),
        part: row.findIndex(isPartHeaderCell),
      },
    };
  });
  if (headerRow === -1) throw new Error('Could not find the "Serial" column. Use the downloaded stock-out template.');
  const out: ParsedStockOutRow[] = [];
  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!isPlainRow(row)) continue;
    const serial = String(row[idx.serial] ?? '').trim().toUpperCase();
    if (!serial) continue;
    out.push({
      date: idx.date !== -1 ? toIsoDate(row[idx.date]) : '',
      serial,
      reference: idx.ref !== -1 ? String(row[idx.ref] ?? '').trim() : '',
      partNumber: idx.part !== -1 ? String(row[idx.part] ?? '').trim() : '',
    });
  }
  return out;
}

export async function parsePartsMasterWorkbook(buf: ArrayBuffer): Promise<ParsedMasterRow[]> {
  const { raw } = await sheetGrid(buf);
  const { headerRow, idx } = findHeader(raw, (row) => {
    const p = row.findIndex(isPartHeaderCell);
    if (p === -1) return { ok: false, idx: {} as Record<string, number> };
    return {
      ok: true,
      idx: {
        part: p,
        desc: row.findIndex(isDescHeaderCell),
        eee: row.findIndex(isEeeHeaderCell),
        sub: row.findIndex(isSubHeaderCell),
        ser: row.findIndex(isSerializedHeaderCell),
      },
    };
  });
  if (headerRow === -1) throw new Error('Could not find the "Part Number" column in this file.');
  const seen = new Set<string>();
  const out: ParsedMasterRow[] = [];
  for (let r = headerRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!isPlainRow(row)) continue;
    const partNumber = String(row[idx.part] ?? '').trim();
    const description = idx.desc !== -1 ? String(row[idx.desc] ?? '').trim() : '';
    if (!partNumber || !description || seen.has(partNumber)) continue;
    seen.add(partNumber);
    const serRaw = idx.ser !== -1 ? String(row[idx.ser] ?? '').trim().toUpperCase() : 'Y';
    out.push({
      part_number: partNumber,
      description,
      eee_code: idx.eee !== -1 && String(row[idx.eee] ?? '').trim() ? String(row[idx.eee] ?? '').trim() : null,
      substitute_part: idx.sub !== -1 && String(row[idx.sub] ?? '').trim() ? String(row[idx.sub] ?? '').trim() : null,
      serialized: serRaw === 'N' || serRaw === 'NO' ? 'N' : 'Y',
    });
  }
  return out;
}
