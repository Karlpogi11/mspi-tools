import { getDbPool } from '../db/index.js';

export interface ResolvedPart {
  part_number: string;
  description: string;
  eee_code: string | null;
  substitute_part: string | null;
  serialized: 'Y' | 'N';
}

let eeeIndex: Map<string, ResolvedPart> | null = null;
let eeeIndexAt = 0;
const EEE_INDEX_TTL_MS = 10 * 60_000;

/**
 * EEE index over `parts_master.eee_code`.
 *
 * The column holds one or more codes separated by `;` (e.g. `20JC;20J7;20J9`).
 * Apple serial numbers CONTAIN the EEE code (e.g. serial `F8Y6042C2TT20J9BP`
 * contains EEE `20J9`), so a scanned serial identifies the part by substring.
 */
async function getEeeIndex(): Promise<Map<string, ResolvedPart>> {
  if (eeeIndex && Date.now() - eeeIndexAt < EEE_INDEX_TTL_MS) return eeeIndex;
  const [rows] = await getDbPool().query(
    "SELECT part_number, description, eee_code, substitute_part, serialized FROM parts_master WHERE eee_code IS NOT NULL AND eee_code != ''"
  );
  const map = new Map<string, ResolvedPart>();
  for (const row of rows as ResolvedPart[]) {
    for (const raw of String(row.eee_code || '').split(';')) {
      // EEE codes never contain whitespace — strip it so entries like
      // "P3 W9" can still match the serials that contain "P3W9".
      const code = raw.trim().toUpperCase().replace(/\s+/g, '');
      if (code.length >= 3 && !map.has(code)) map.set(code, row);
    }
  }
  eeeIndex = map;
  eeeIndexAt = Date.now();
  return map;
}

export function invalidateEeeIndex() {
  eeeIndex = null;
}

export async function resolveByEee(eee: string): Promise<ResolvedPart | null> {
  const code = String(eee ?? '').trim().toUpperCase();
  if (!code) return null;
  return (await getEeeIndex()).get(code) ?? null;
}

/**
 * Identify the part from a scanned serial by finding the EEE code inside it.
 * Longest match wins so short codes can't shadow longer ones.
 */
export async function resolveBySerial(serial: string): Promise<{ part: ResolvedPart; eee: string } | null> {
  const s = String(serial ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (s.length < 3) return null;
  const index = await getEeeIndex();
  let best: { code: string; part: ResolvedPart } | null = null;
  for (const [code, part] of index) {
    if (code.length >= 3 && s.includes(code) && (!best || code.length > best.code.length)) {
      best = { code, part };
    }
  }
  return best ? { part: best.part, eee: best.code } : null;
}

export async function resolveByPartNumber(partNumber: string): Promise<ResolvedPart | null> {
  const part = String(partNumber ?? '').trim();
  if (!part) return null;
  const [rows] = await getDbPool().query(
    'SELECT part_number, description, eee_code, substitute_part, serialized FROM parts_master WHERE part_number = ? LIMIT 1',
    [part]
  );
  const row = (rows as Array<ResolvedPart>)[0];
  return row ?? null;
}
