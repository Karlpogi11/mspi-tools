import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface WordBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}

export interface TextLayer {
  fullText: string;
  regionText: string;
  words: WordBox[];
  pageWidth: number;
  pageHeight: number;
}

export const REGION_X0 = 0.4; // right of 40% of page width
export const REGION_Y1 = 0.35; // top 35% of page height

function splitItemWords(item: any): WordBox[] {
  const out: WordBox[] = [];
  const str: string = item?.str ?? '';
  const parts = str.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return out;
  const [a, , , d, e, f] = item.transform ?? [1, 0, 0, 1, 0, 0];
  const itemWidth = Math.abs(Number(item.width) || 0);
  const scale = a !== 0 ? Math.abs(a) : 1;
  const total = str.length;
  let offset = 0;
  for (const part of parts) {
    const idx = str.indexOf(part, offset);
    const start = idx >= 0 ? idx : offset;
    const startX = e + scale * itemWidth * (start / total);
    const endX = e + scale * itemWidth * ((start + part.length) / total);
    out.push({
      x0: startX,
      y0: f,
      x1: endX,
      y1: f + Math.abs(d),
      text: part,
    });
    offset = start + part.length;
  }
  return out;
}

export function groupLines(words: WordBox[]): string[] {
  const lines: WordBox[][] = [];
  const sorted = [...words].sort((wa, wb) => wa.y0 - wb.y0 || wa.x0 - wb.x0);
  for (const w of sorted) {
    const lastLine = lines[lines.length - 1];
    const lastWord = lastLine?.[lastLine.length - 1];
    if (lastWord && w.y0 - lastWord.y0 < Math.max(6, w.y1 - w.y0) * 0.5) {
      lastLine.push(w);
    } else {
      lines.push([w]);
    }
  }
  return lines.map((line) => line.map((w) => w.text).join(' '));
}

export function upperRightRegion(words: WordBox[], pageWidth: number, pageHeight: number): string {
  const sel = words.filter((w) => w.x0 >= pageWidth * REGION_X0 && w.y0 <= pageHeight * REGION_Y1);
  if (sel.length === 0) return '';
  return groupLines(sel).join('\n');
}

export async function extractTextLayer(pdfBuf: Buffer): Promise<TextLayer | null> {
  let doc: any;
  try {
    doc = await getDocument({ data: new Uint8Array(pdfBuf) }).promise;
    const fullParts: string[] = [];
    const regionParts: string[] = [];
    const allWords: WordBox[] = [];
    let pageWidth = 0;
    let pageHeight = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pageWidth = viewport.width;
      pageHeight = viewport.height;
      const content = await page.getTextContent();
      const words: WordBox[] = [];
      for (const item of content.items) {
        words.push(...splitItemWords(item));
      }
      allWords.push(...words);
      fullParts.push(groupLines(words).join('\n'));
      regionParts.push(upperRightRegion(words, pageWidth, pageHeight));
    }
    if (fullParts.join('\n').trim().length === 0) return null;
    return {
      fullText: fullParts.join('\n'),
      regionText: regionParts.join('\n'),
      words: allWords,
      pageWidth,
      pageHeight,
    };
  } catch (err) {
    console.error('[pdf] text layer failed:', (err as Error)?.message);
    return null;
  } finally {
    try {
      await doc?.destroy();
    } catch {}
  }
}