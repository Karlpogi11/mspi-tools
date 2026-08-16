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

export async function forEachRenderedPdfPage(
  pdfBuf: Buffer,
  density: number,
  onPage: (page: RenderedPage, pageNumber: number) => Promise<void>
): Promise<number> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBuf) });
  const doc = await loadingTask.promise;
  try {
    const scale = pageScale(density);
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
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
      await onPage({ png: canvas.toBuffer('image/png'), width, height }, pageNumber);
      page.cleanup();
    }
    return doc.numPages;
  } finally {
    await loadingTask.destroy();
  }
}
