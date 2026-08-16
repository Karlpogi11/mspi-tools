import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
}

function pageScale(density: number): number {
  return density / 72;
}

export async function renderPdfPages(pdfBuf: Buffer, density = 200): Promise<RenderedPage[]> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBuf) });
  const doc = await loadingTask.promise;
  const out: RenderedPage[] = new Array(doc.numPages);
  try {
    const scale = pageScale(density);
    let next = 1;
    async function worker() {
      while (next <= doc.numPages) {
        const i = next++;
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
        out[i - 1] = { png: canvas.toBuffer('image/png'), width, height };
        page.cleanup();
      }
    }
    const workers = Math.max(1, Math.min(3, doc.numPages));
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    await loadingTask.destroy();
  }
  return out;
}