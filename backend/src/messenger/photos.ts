import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PULSE_DATA_DIR = path.resolve(
  process.env.PULSE_DATA_DIR ?? path.resolve(HERE, '..', '..', 'data', 'pulse')
);
export const PULSE_TMP = path.join(PULSE_DATA_DIR, 'tmp');
export const PULSE_FULL = path.join(PULSE_DATA_DIR, 'full');
export const PULSE_THUMBS = path.join(PULSE_DATA_DIR, 'thumbs');

export function ensurePulseDirs(): void {
  for (const dir of [PULSE_TMP, PULSE_FULL, PULSE_THUMBS]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensurePulseDirs();

export const MAX_PHOTO_FILES_PER_MESSAGE = 4;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const photoUpload = multer({
  dest: PULSE_TMP,
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTO_FILES_PER_MESSAGE },
});

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface StoredPhoto {
  /** Content-hash id, also the public filename stem. */
  id: string;
  mime: string;
  ext: string;
  width: number;
  height: number;
  bytes: number;
}

/** Sniff real content (never trust extension), normalize to JPEG, write full + thumb. */
export async function storePhoto(tmpPath: string): Promise<StoredPhoto> {
  const buffer = await fs.promises.readFile(tmpPath);
  try {
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Only JPEG, PNG, WebP, or GIF images are allowed.');
    }
    const id = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
    const full = sharp(buffer, { animated: false }).rotate();
    const meta = await full.metadata();
    const fullJpeg = await full
      .clone()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const fullMeta = await sharp(fullJpeg).metadata();
    const thumb = await sharp(fullJpeg)
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    await fs.promises.writeFile(path.join(PULSE_FULL, `${id}.jpg`), fullJpeg);
    await fs.promises.writeFile(path.join(PULSE_THUMBS, `${id}.jpg`), thumb);
    return {
      id,
      mime: 'image/jpeg',
      ext: 'jpg',
      width: fullMeta.width ?? meta.width ?? 0,
      height: fullMeta.height ?? meta.height ?? 0,
      bytes: fullJpeg.length,
    };
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

/** Resolve a stored photo path, contained to its directory (no traversal). */
export function resolvePhoto(kind: 'full' | 'thumb', id: string): string | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const dir = kind === 'full' ? PULSE_FULL : PULSE_THUMBS;
  const resolved = path.resolve(dir, `${id}.jpg`);
  if (resolved !== path.join(dir, `${id}.jpg`)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}
