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
  renamedFile?: string;
  pageCount?: number;
  deepAnalysis?: boolean;
}

export const MAX_PDF_FILES_PER_REQUEST = 50;
export const PDF_PROCESS_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.PDF_PROCESS_CONCURRENCY) || 2));

export const upload = multer({
  dest: INBOX,
  limits: { fileSize: 60 * 1024 * 1024, files: MAX_PDF_FILES_PER_REQUEST },
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
  let pageCount = 0;
  let deepAnalysis = false;

  try {
    const r = await extractFieldsFromFile(filePath);
    fields = r.fields;
    method = r.method;
    permit = r.permit;
    pageCount = r.pageCount;
    deepAnalysis = r.deepAnalysis;
  } catch (err) {
    const dest = uniqueDest(ERRORS, `${path.parse(fileName).name}_UNREADABLE.pdf`);
    fs.renameSync(filePath, dest);
    return {
      file: fileName,
      status: 'error',
      method,
      reasons: ['UNREADABLE'],
      dest: dest,
      deepAnalysis: true,
    };
  }

  const validInvoiceRef = /^SG\d{6,}$/i.test(fields.InvoiceReference || '');
  if (!validInvoiceRef && isInvoiceRefFilename(fileName)) {
    fields.InvoiceReference = path.parse(fileName).name;
  }
  const structuralReasons: string[] = [];
  if (pageCount < 2) structuralReasons.push('MISSING_PAGE_2');
  if (!validInvoiceRef) structuralReasons.push('INVOICE_REF');

  if (structuralReasons.length > 0) {
    const label = validInvoiceRef ? fields.InvoiceReference : path.parse(fileName).name;
    const dest = uniqueDest(ERRORS, `${label}_MISSING_${structuralReasons.join('_')}.pdf`);
    fs.renameSync(filePath, dest);
    return { file: fileName, status: 'error', method, reasons: structuralReasons, fields, dest, permit, pageCount, deepAnalysis };
  }

  if (permit) {
    const ref = fields.InvoiceReference;
    const renamedFile = `${ref}.pdf`;
    const dest = uniqueDest(PERMITS, renamedFile);
    fs.renameSync(filePath, dest);
    return {
      file: fileName,
      status: 'permit',
      method,
      fields,
      dest,
      permit: true,
      renamedFile,
      pageCount,
      deepAnalysis,
    };
  }

  const reasons = missingFields(fields);

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
      pageCount,
      deepAnalysis,
    };
  }

  const { folder } = monthFolderFor(fields.DeliveryDate);
  const monthDir = path.join(PROCESSED, folder);
  fs.mkdirSync(monthDir, { recursive: true });
  const renamedFile = `${fields.InvoiceReference}.pdf`;
  const dest = uniqueDest(monthDir, renamedFile);
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
    renamedFile,
    pageCount,
    deepAnalysis,
  };
}

/** Keep one failed file from aborting the rest of a submitted batch. */
export async function processPdfFileSafely(
  filePath: string,
  originalName: string,
  userId: number | null
): Promise<ProcessResult> {
  try {
    return await processPdfFile(filePath, originalName, userId);
  } catch (err) {
    console.error(`[pdf-extractor] unexpected failure for ${originalName}:`, err);
    const fileName = safeFileName(originalName || path.basename(filePath));
    let dest: string | undefined;
    if (fs.existsSync(filePath)) {
      dest = uniqueDest(ERRORS, `${path.parse(fileName).name}_PROCESSING_ERROR.pdf`);
      fs.renameSync(filePath, dest);
    }
    return {
      file: fileName,
      status: 'error',
      reasons: ['PROCESSING_ERROR'],
      dest,
    };
  }
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
