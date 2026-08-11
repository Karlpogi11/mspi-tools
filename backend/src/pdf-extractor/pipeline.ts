import fs from 'fs';
import { extractTextLayer } from './pdf.js';
import { renderPdfPages } from './raster.js';
import { ocrPool } from './ocr.js';
import { mergeFields, missingFields, parseFields, type ParsedFields } from './parser.js';

export interface ExtractResult {
  fields: ParsedFields;
  permit: boolean;
  method: string;
}

export async function extractFieldsFromBuffer(pdfBuf: Buffer): Promise<ExtractResult> {
  const attempts: Array<{ label: string; run: () => Promise<{ text: string; region: string }> }> = [
    {
      label: 'text layer',
      run: async () => {
        const layer = await extractTextLayer(pdfBuf);
        if (!layer) throw new Error('no text layer');
        return { text: layer.fullText, region: layer.regionText };
      },
    },
    { label: 'OCR 200dpi', run: async () => ocrPdf(pdfBuf, 200) },
    { label: 'OCR 300dpi', run: async () => ocrPdf(pdfBuf, 300) },
    { label: 'OCR 400dpi', run: async () => ocrPdf(pdfBuf, 400) },
  ];

  const fields: Partial<ParsedFields> = {};
  let permit = false;
  let lastMethod = '';
  for (const attempt of attempts) {
    let text = '';
    let region = '';
    try {
      const r = await attempt.run();
      text = r.text;
      region = r.region;
    } catch (err) {
      console.log(`  [${attempt.label}] failed (${(err as Error)?.message ?? err})`);
      continue;
    }
    if (!permit && /\bpermit\b/i.test(text)) permit = true;
    fields.HAWB = fields.HAWB ?? '';
    const merged = mergeFields(fields as ParsedFields, parseFields(text, region));
    for (const key of ['HAWB', 'InvoiceReference', 'InvoiceTotalAmount', 'DeliveryDate', 'TotalQty']) {
      fields[key] = merged[key];
    }
    lastMethod = attempt.label;
    if (missingFields(fields as ParsedFields).length === 0 && fields.InvoiceReference) {
      break;
    }
  }
  return { fields: fields as ParsedFields, permit, method: lastMethod };
}

export async function extractFieldsFromFile(pdfPath: string): Promise<ExtractResult> {
  const buf = fs.readFileSync(pdfPath);
  return extractFieldsFromBuffer(buf);
}

async function ocrPdf(pdfBuf: Buffer, dpi: number): Promise<{ text: string; region: string }> {
  const pages = await renderPdfPages(pdfBuf, dpi);
  const fullParts: string[] = [];
  const regionParts: string[] = [];
  for (const page of pages) {
    const r = await ocrPool.recognize(page.png, page.width, page.height);
    if (!r.fullText.trim()) continue;
    fullParts.push(r.fullText);
    regionParts.push(r.regionText);
  }
  if (fullParts.length === 0) {
    throw new Error('tesseract produced no text');
  }
  return { text: fullParts.join('\n'), region: regionParts.join('\n') };
}