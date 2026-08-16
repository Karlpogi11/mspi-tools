import fs from 'fs';
import { extractTextLayer } from './pdf.js';
import { forEachRenderedPdfPage } from './raster.js';
import { OCR_WORKER_COUNT, ocrPool, type OcrPage } from './ocr.js';
import { mapLimit } from './concurrency.js';
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
    // Full-document OCR is expensive. One fast pass handles normal scans;
    // one enhanced recovery pass preserves accuracy for difficult documents.
    { label: 'OCR 220dpi', run: async () => ocrPdf(pdfBuf, 220) },
    { label: 'enhanced OCR 350dpi', deep: true, run: async () => ocrPdf(pdfBuf, 350, true) },
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
  const pageResults: OcrPage[] = [];
  // Typical documents fit in one batch. Larger files are rasterized in chunks
  // so high-DPI PNG buffers cannot grow without bound on shared hosting.
  const rasterBatchSize = Math.max(4, Math.min(8, OCR_WORKER_COUNT * 2));
  const pageCount = await forEachRenderedPdfPage(pdfBuf, dpi, async (pages) => {
    const results = await mapLimit(pages, OCR_WORKER_COUNT, async (page) => {
      const png = enhance ? await sharp(page.png).grayscale().normalize().sharpen().png().toBuffer() : page.png;
      const result = await ocrPool.recognize(png, page.width, page.height);
      return { pageNumber: page.pageNumber, result };
    });
    for (const { pageNumber, result } of results) pageResults[pageNumber - 1] = result;
  }, rasterBatchSize);

  const fullParts: string[] = [];
  const regionParts: string[] = [];
  const allWords: WordBox[] = [];
  for (const result of pageResults) {
    if (!result) continue;
    if (result.fullText.trim()) fullParts.push(result.fullText);
    if (result.regionText) regionParts.push(result.regionText);
    allWords.push(...result.words);
  }
  const texts = fullParts.filter((text) => text.trim());
  if (texts.length === 0) {
    throw new Error('tesseract produced no text');
  }
  return {
    text: texts.join('\n'),
    region: regionParts.filter((t) => t).join('\n'),
    words: allWords,
    pageCount,
  };
}
