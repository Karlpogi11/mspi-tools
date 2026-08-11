import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { ERRORS, INBOX, PERMITS, PROCESSED, safeFileName } from './paths.js';
import { extractFieldsFromFile } from './pipeline.js';
import {
  isInvoiceRefFilename,
  missingFields,
  monthFolderFor,
  type ParsedFields,
} from './parser.js';
import { insertAwbLog } from './store.js';

export type ProcessStatus = 'ok' | 'duplicate' | 'error' | 'permit';

export interface ProcessResult {
  file: string;
  status: ProcessStatus;
  method?: string;
  reasons?: string[];
  fields?: ParsedFields;
  dest?: string;
  monthFolder?: string;
  permit?: boolean;
}

export const upload = multer({
  dest: INBOX,
  limits: { fileSize: 60 * 1024 * 1024, files: 20 },
});

function uniqueDest(dir: string, baseName: string): string {
  const dest = path.join(dir, baseName);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  return path.join(dir, `${stem}_${Date.now()}${ext}`);
}

export async function processPdfFile(
  filePath: string,
  originalName: string,
  userId: number | null
): Promise<ProcessResult> {
  const fileName = safeFileName(originalName || path.basename(filePath));
  let fields: ParsedFields;
  let method = '';
  let permit = false;

  try {
    const r = await extractFieldsFromFile(filePath);
    fields = r.fields;
    method = r.method;
    permit = r.permit;
  } catch (err) {
    const dest = uniqueDest(ERRORS, `${path.parse(fileName).name}_UNREADABLE.pdf`);
    fs.renameSync(filePath, dest);
    return {
      file: fileName,
      status: 'error',
      method,
      reasons: ['UNREADABLE'],
      dest: dest,
    };
  }

  if (permit) {
    const ref = fields.InvoiceReference || path.parse(fileName).name;
    const dest = uniqueDest(PERMITS, `${ref}.pdf`);
    fs.renameSync(filePath, dest);
    return {
      file: fileName,
      status: 'permit',
      method,
      fields,
      dest,
      permit: true,
    };
  }

  const reasons = missingFields(fields);
  if (!fields.InvoiceReference) reasons.push('INVOICE_REF');

  if (reasons.length > 0) {
    const label = fields.InvoiceReference || path.parse(fileName).name;
    const dest = uniqueDest(ERRORS, `${label}_MISSING_${reasons.join('_')}.pdf`);
    fs.renameSync(filePath, dest);
    return {
      file: fileName,
      status: 'error',
      method,
      reasons,
      fields,
      dest,
    };
  }

  const { folder } = monthFolderFor(fields.DeliveryDate);
  const monthDir = path.join(PROCESSED, folder);
  fs.mkdirSync(monthDir, { recursive: true });
  const dest = uniqueDest(monthDir, `${fields.InvoiceReference}.pdf`);
  fs.renameSync(filePath, dest);

  const { inserted } = await insertAwbLog(
    {
      hawb: fields.HAWB,
      invoice_reference: fields.InvoiceReference,
      invoice_total_amount: fields.InvoiceTotalAmount,
      delivery_date: fields.DeliveryDate,
      total_qty: fields.TotalQty,
      received_date: '',
      original_filename: fileName,
      month_folder: folder,
    },
    userId
  );

  return {
    file: fileName,
    status: inserted ? 'ok' : 'duplicate',
    method,
    fields,
    dest,
    monthFolder: folder,
  };
}

export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}