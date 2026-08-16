import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
  pageNumber: number;
}

function pageScale(density: number): number {
  return density / 72;
}

export async function forEachRenderedPdfPage(
  pdfBuf: Buffer,
  density: number,
  onPages: (pages: RenderedPage[], pageCount: number) => Promise<void>,
  maxPagesInMemory = 4,
): Promise<number> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBuf) });
  const doc = await loadingTask.promise;
  try {
    const scale = pageScale(density);
    const pageBatch: RenderedPage[] = [];
    const batchSize = Math.max(1, Math.floor(maxPagesInMemory));
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
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
        pageBatch.push({ png: canvas.toBuffer('image/png'), width, height, pageNumber });
      } finally {
        page.cleanup();
      }

      if (pageBatch.length >= batchSize || pageNumber === doc.numPages) {
        await onPages(pageBatch.splice(0), doc.numPages);
      }
    }
    return doc.numPages;
  } finally {
    await loadingTask.destroy();
  }
}
