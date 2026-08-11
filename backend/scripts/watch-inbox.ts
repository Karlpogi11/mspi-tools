import path from 'path';
import chokidar from 'chokidar';
import { initDb } from '../src/db/index.js';
import { INBOX } from '../src/pdf-extractor/paths.js';
import { mapLimit, processPdfFile } from '../src/pdf-extractor/runner.js';
import { ocrPool } from '../src/pdf-extractor/ocr.js';

const inFlight = new Set<string>();
let shutdown = false;

function summary(r: Awaited<ReturnType<typeof processPdfFile>>) {
  const f = r.fields ?? {};
  switch (r.status) {
    case 'ok':
      return `[OK] ${r.file} → ${path.relative(process.cwd(), r.dest ?? '')} (Ref=${f.InvoiceReference} | Amt=${f.InvoiceTotalAmount} | Date=${f.DeliveryDate} | Qty=${f.TotalQty})`;
    case 'duplicate':
      return `[DUP] ${r.file} → already logged (Ref=${f.InvoiceReference})`;
    case 'permit':
      return `[PERMIT] ${r.file} → ${path.relative(process.cwd(), r.dest ?? '')}`;
    default:
      return `[ERROR] ${r.file} → missing ${r.reasons?.join(', ') || 'unreadable'} (${path.relative(process.cwd(), r.dest ?? '')})`;
  }
}

async function handle(pathName: string) {
  if (shutdown) return;
  if (inFlight.has(pathName)) return;
  inFlight.add(pathName);
  try {
    const result = await processPdfFile(pathName, path.basename(pathName), null);
    console.log(summary(result));
  } catch (err) {
    console.error(`[ERROR] ${path.basename(pathName)}: ${(err as Error)?.message ?? err}`);
  } finally {
    inFlight.delete(pathName);
  }
}

async function main() {
  try {
    await initDb();
  } catch {
    console.warn('Database unavailable — extracted files will be filed but not logged');
  }

  const watcher = chokidar.watch(INBOX, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
  });

  watcher.on('add', (p) => {
    if (p.toLowerCase().endsWith('.pdf')) void handle(p);
  });
  watcher.on('error', (err) => console.error('[watcher] error:', err));

  console.log(`[Watcher] Watching ${INBOX} — drop PDFs to extract automatically. Ctrl+C to stop.`);

  const shutdownHook = async () => {
    shutdown = true;
    await watcher.close();
    await ocrPool.terminate();
    process.exit(0);
  };
  process.on('SIGINT', shutdownHook);
  process.on('SIGTERM', shutdownHook);
}

main().catch((err) => {
  console.error('Watcher failed to start:', err);
  process.exit(1);
});