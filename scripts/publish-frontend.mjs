import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'frontend/dist');
const target = resolve(root, 'backend/dist/public');
const staging = resolve(root, 'backend/dist/public.next');
const backup = resolve(root, 'backend/dist/public.previous');

if (!existsSync(source)) {
  throw new Error(`Frontend build output not found: ${source}`);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, staging, { recursive: true });

const hadCurrent = existsSync(target);
rmSync(backup, { recursive: true, force: true });
if (hadCurrent) renameSync(target, backup);

try {
  renameSync(staging, target);
  rmSync(backup, { recursive: true, force: true });
} catch (error) {
  rmSync(target, { recursive: true, force: true });
  if (hadCurrent && existsSync(backup)) renameSync(backup, target);
  throw error;
}

console.log('Frontend published atomically.');
