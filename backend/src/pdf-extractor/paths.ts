import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(
  process.env.PDF_EXTRACTOR_DATA ?? path.resolve(HERE, '..', '..', 'data', 'pdf-extractor')
);

export const INBOX = path.join(DATA_DIR, 'inbox');
export const PROCESSED = path.join(DATA_DIR, 'processed');
export const ERRORS = path.join(DATA_DIR, 'errors');
export const PERMITS = path.join(DATA_DIR, 'permits');

export function ensureDirs() {
  for (const dir of [INBOX, PROCESSED, ERRORS, PERMITS]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirs();

export function safeFileName(name: string): string {
  return path.basename(name).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
}