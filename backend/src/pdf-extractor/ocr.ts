import { createWorker, type Worker } from 'tesseract.js';
import { groupLines, upperRightRegion, type WordBox } from './pdf.js';

// Tesseract workers are memory-heavy. Shared hosting stays stable with one
// worker; raise this explicitly only after increasing the server memory limit.
const configuredWorkerCount = Number.parseInt(process.env.OCR_WORKER_COUNT ?? '1', 10);
const POOL_SIZE = Math.max(1, Math.min(2, Number.isFinite(configuredWorkerCount) ? configuredWorkerCount : 1));

export interface OcrPage {
  fullText: string;
  regionText: string;
  words: WordBox[];
}

function wordsFromBlocks(data: any): WordBox[] {
  const out: WordBox[] = [];
  const blocks: any[] = data?.blocks ?? [];
  for (const block of blocks) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        for (const word of line?.words ?? []) {
          const text: string = word?.text?.trim() ?? '';
          const conf: number = Number(word?.confidence ?? 0);
          if (!text || conf <= 0) continue;
          const bbox = word?.bbox;
          if (!bbox) continue;
          out.push({ x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1, text });
        }
      }
    }
  }
  return out;
}

class TesseractPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private initPromise: Promise<void> | null = null;
  private failed = false;

  private async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const langs = process.env.TESSERACT_LANG || 'eng';
      const options: Record<string, unknown> = {};
      if (process.env.TESSERACT_LANG_PATH) {
        options.langPath = process.env.TESSERACT_LANG_PATH;
      }
      await Promise.all(
        Array.from({ length: POOL_SIZE }, async () => {
          try {
            const worker = await createWorker(langs, 1, options);
            this.workers.push(worker);
            this.busy.push(0);
          } catch (err) {
            console.error('[ocr] worker init failed:', (err as Error)?.message);
          }
        })
      );
      if (this.workers.length === 0) this.failed = true;
    })();
    return this.initPromise;
  }

  private pickWorker(): number {
    let idx = 0;
    for (let i = 1; i < this.busy.length; i++) {
      if (this.busy[i] < this.busy[idx]) idx = i;
    }
    return idx;
  }

  async recognize(png: Buffer, pageWidth: number, pageHeight: number): Promise<OcrPage> {
    await this.init();
    if (this.failed || this.workers.length === 0) {
      throw new Error('tesseract workers unavailable');
    }
    const idx = this.pickWorker();
    this.busy[idx]++;
    try {
      const { data } = await this.workers[idx].recognize(png, {}, { blocks: true });
      const words = wordsFromBlocks(data);
      const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      return {
        fullText: groupLines(sorted).join('\n'),
        regionText: upperRightRegion(sorted, pageWidth, pageHeight),
        words: sorted,
      };
    } catch (err) {
      console.error('[ocr] recognize failed:', (err as Error)?.message);
      throw err;
    } finally {
      this.busy[idx]--;
    }
  }

  async terminate() {
    await Promise.allSettled(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.busy = [];
    this.initPromise = null;
  }
}

export const ocrPool = new TesseractPool();
