import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.resolve(process.env.MESSENGER_DATA_DIR ?? path.resolve(HERE, '..', '..', 'data', 'messenger'));
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const FULL_DIR = path.join(DATA_DIR, 'full');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

export function ensureDirs(): void {
  for (const dir of [TMP_DIR, FULL_DIR, THUMBS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirs();

export const MAX_PHOTO_FILES_PER_MESSAGE = 4;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const photoUpload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTO_FILES_PER_MESSAGE },
});

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface StoredPhoto {
  id: string;
  mime: string;
  ext: string;
  width: number;
  height: number;
  bytes: number;
}

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
    await fs.promises.writeFile(path.join(FULL_DIR, `${id}.jpg`), fullJpeg);
    await fs.promises.writeFile(path.join(THUMBS_DIR, `${id}.jpg`), thumb);
    return { id, mime: 'image/jpeg', ext: 'jpg', width: fullMeta.width ?? meta.width ?? 0, height: fullMeta.height ?? meta.height ?? 0, bytes: fullJpeg.length };
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

export function resolvePhoto(kind: 'full' | 'thumb', id: string): string | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const dir = kind === 'full' ? FULL_DIR : THUMBS_DIR;
  const resolved = path.resolve(dir, `${id}.jpg`);
  if (resolved !== path.join(dir, `${id}.jpg`)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}
