export interface PdfDiagnostic {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  file?: string;
  runId?: string;
  batchId?: string;
}

const MAX_DIAGNOSTICS = 250;
const diagnostics: PdfDiagnostic[] = [];
let nextId = 1;

function compact(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

/** In-memory by design: diagnostic data is temporary and never exposed to non-admin users. */
export function recordPdfDiagnostic(entry: Omit<PdfDiagnostic, 'id' | 'timestamp'>) {
  diagnostics.push({
    id: nextId++,
    timestamp: new Date().toISOString(),
    level: entry.level,
    event: compact(entry.event, 80) ?? 'unknown',
    message: compact(entry.message, 600) ?? 'No message',
    file: compact(entry.file, 200),
    runId: compact(entry.runId, 100),
    batchId: compact(entry.batchId, 100),
  });
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
}

export function listPdfDiagnostics() {
  return [...diagnostics].reverse();
}

export function clearPdfDiagnostics() {
  diagnostics.length = 0;
}
