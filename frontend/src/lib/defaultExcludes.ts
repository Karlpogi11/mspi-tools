const STORAGE_KEY = 'pcount.defaultExcludes.v1';

// Built-in default exclude list (seeded from the session's Excluded tab).
// Always pre-filled in the System Import box, even before anything is saved.
const BUILT_IN_DEFAULT_EXCLUDES = [
  'PMCHOLTAG001',
  'MXVU3ZP/A',
  'MSP0003LAR',
  'MSP0002MED',
  'MSP0001SML',
  '661-10103',
  '661-10102',
  '661-09081',
  '661-09034',
  '661-09033',
  '661-09032',
  '661-08934',
  '661-08933',
  '661-07300',
  '661-07299',
  '661-07298',
  '661-07297',
  '661-07296',
  '661-07295',
  '661-07294',
  '661-07293',
  '661-07292',
  '661-07291',
  '661-07290',
  '661-07289',
  '661-07288',
  '661-07287',
  '661-07286',
  '661-07285',
  '661-05755',
  '661-05421',
  '661-04582',
  '661-04581',
  '661-04580',
  '661-04579',
];

function loadSavedExcludes(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parseExcludeCodes(parsed.filter((c): c is string => typeof c === 'string').join('\n'));
  } catch {
    return [];
  }
}

export function parseExcludeCodes(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[\s,;]+/)) {
    const code = raw.trim().toUpperCase();
    if (code && !seen.has(code)) seen.add(code);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function loadDefaultExcludes(): string[] {
  // Union of built-in seed + anything saved on this device. Built-ins always show.
  const seen = new Set<string>();
  for (const code of [...BUILT_IN_DEFAULT_EXCLUDES, ...loadSavedExcludes()]) {
    if (code && !seen.has(code)) seen.add(code);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function saveDefaultExcludes(codes: string[] | string): string[] {
  const normalized = Array.isArray(codes) ? parseExcludeCodes(codes.join('\n')) : parseExcludeCodes(codes);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
  return normalized;
}

export function clearDefaultExcludes(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export interface DefaultMissingCount {
  code: string;
  counted: number;
}

// Built-in default missing counts (seeded from the session's Missing tab).
// These codes arrive already counted + marked stolen, so their status lands in
// Missing automatically on System Import — no manual count entry needed.
// NOTE: absolute actual counts. If a future file carries a different system qty,
// status still derives from it (counted >= system → matched, else missing).
const BUILT_IN_DEFAULT_MISSING: DefaultMissingCount[] = [
  { code: 'JBLI476BLU', counted: 0 },
  { code: 'JBLI474BLK', counted: 1 },
  { code: 'BOSI135BLU', counted: 1 },
  { code: 'BOSI134WHT', counted: 0 },
  { code: 'BOSI105BLK', counted: 1 },
];

export function loadDefaultMissing(): DefaultMissingCount[] {
  const seen = new Set<string>();
  const out: DefaultMissingCount[] = [];
  for (const row of BUILT_IN_DEFAULT_MISSING) {
    const code = row.code.trim().toUpperCase();
    const counted = Math.max(0, Math.floor(Number(row.counted) || 0));
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push({ code, counted });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
