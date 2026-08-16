import fs from 'fs';
import { extractTextLayer } from './pdf.js';
import { renderPdfPages } from './raster.js';
import { ocrPool } from './ocr.js';
import { mergeFields, missingFields, parseFields, type ParsedFields } from './parser.js';
import type { WordBox } from './pdf.js';
import sharp from 'sharp';

export interface ExtractResult {
  fields: ParsedFields;
  permit: boolean;
  method: string;
  pageCount: number;
  deepAnalysis: boolean;
}

export async function extractFieldsFromBuffer(pdfBuf: Buffer): Promise<ExtractResult> {
  const attempts: Array<{ label: string; deep?: boolean; run: () => Promise<{ text: string; region: string; words: WordBox[]; pageCount: number }> }> = [
    {
      label: 'text layer',
      run: async () => {
        const layer = await extractTextLayer(pdfBuf);
        if (!layer) throw new Error('no text layer');
        return { text: layer.fullText, region: layer.regionText, words: layer.words, pageCount: layer.pageCount };
      },
    },
    { label: 'OCR 200dpi', run: async () => ocrPdf(pdfBuf, 200) },
    { label: 'OCR 300dpi', run: async () => ocrPdf(pdfBuf, 300) },
    { label: 'enhanced OCR 400dpi', deep: true, run: async () => ocrPdf(pdfBuf, 400, true) },
  ];

  const fields: Partial<ParsedFields> = {};
  let permit = false;
  let lastMethod = '';
  let pageCount = 0;
  let deepAnalysis = false;
  for (const attempt of attempts) {
    let text = '';
    let region = '';
    let words: WordBox[] = [];
    try {
      const r = await attempt.run();
      text = r.text;
      region = r.region;
      words = r.words;
      pageCount = Math.max(pageCount, r.pageCount);
    } catch (err) {
      console.log(`  [${attempt.label}] failed (${(err as Error)?.message ?? err})`);
      continue;
    }
    if (!permit && /\bpermit\b/i.test(text)) permit = true;
    fields.HAWB = fields.HAWB ?? '';
    const merged = mergeFields(fields as ParsedFields, parseFields(text, region, words));
    for (const key of ['HAWB', 'InvoiceReference', 'InvoiceTotalAmount', 'DeliveryDate', 'TotalQty']) {
      fields[key] = merged[key];
    }
    lastMethod = attempt.label;
    if (attempt.deep) deepAnalysis = true;
    if (missingFields(fields as ParsedFields).length === 0 && fields.InvoiceReference) {
      break;
    }
  }
  return { fields: fields as ParsedFields, permit, method: lastMethod, pageCount, deepAnalysis };
}

export async function extractFieldsFromFile(pdfPath: string): Promise<ExtractResult> {
  const buf = fs.readFileSync(pdfPath);
  return extractFieldsFromBuffer(buf);
}

async function ocrPdf(pdfBuf: Buffer, dpi: number, enhance = false): Promise<{ text: string; region: string; words: WordBox[]; pageCount: number }> {
  const pages = await renderPdfPages(pdfBuf, dpi);
  const fullParts: string[] = new Array(pages.length);
  const regionParts: string[] = new Array(pages.length);
  const pageWords: WordBox[][] = new Array(pages.length);
  let next = 0;
  async function worker() {
    while (next < pages.length) {
      const index = next++;
      const page = pages[index];
      const png = enhance ? await sharp(page.png).grayscale().normalize().sharpen().png().toBuffer() : page.png;
      const r = await ocrPool.recognize(png, page.width, page.height);
      fullParts[index] = r.fullText;
      regionParts[index] = r.regionText;
      pageWords[index] = r.words;
    }
  }
  const workers = Math.max(1, Math.min(3, pages.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  const texts = fullParts.filter((t) => t.trim());
  if (texts.length === 0) {
    throw new Error('tesseract produced no text');
  }
  return {
    text: texts.join('\n'),
    region: regionParts.filter((t) => t).join('\n'),
    words: pageWords.flat(),
    pageCount: pages.length,
  };
}
