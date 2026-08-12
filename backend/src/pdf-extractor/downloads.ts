import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ZipArchive } from 'archiver';
import { DOWNLOADS } from './paths.js';
import type { ProcessResult } from './runner.js';

interface DownloadArtifact {
  path: string;
  name: string;
  createdAt: number;
}

const artifacts = new Map<string, DownloadArtifact>();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cleanExpiredArtifacts() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [token, artifact] of artifacts) {
    if (artifact.createdAt >= cutoff) continue;
    if (artifact.path.startsWith(DOWNLOADS)) fs.rmSync(artifact.path, { force: true });
    artifacts.delete(token);
  }
}

export async function createDownloadArtifact(results: ProcessResult[]) {
  cleanExpiredArtifacts();
  const downloadable = results.filter((result) => result.dest);
  if (downloadable.length === 0) return null;

  const token = randomUUID();
  if (downloadable.length === 1) {
    const only = downloadable[0];
    const name = only.renamedFile || path.basename(only.dest!);
    artifacts.set(token, { path: only.dest!, name, createdAt: Date.now() });
    return { url: `/api/pdf-extractor/download/${token}`, name, count: 1 };
  }

  const zipName = `renamed-invoices-${new Date().toISOString().slice(0, 10)}.zip`;
  const zipPath = path.join(DOWNLOADS, `${token}.zip`);
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const result of downloadable) {
      const folder = result.status === 'error' ? 'Needs Attention' : result.status === 'permit' ? 'With Permit' : 'Without Permit';
      archive.file(result.dest!, { name: `${folder}/${result.renamedFile || path.basename(result.dest!)}` });
    }
    void archive.finalize();
  });
  artifacts.set(token, { path: zipPath, name: zipName, createdAt: Date.now() });
  return { url: `/api/pdf-extractor/download/${token}`, name: zipName, count: downloadable.length };
}

export function getDownloadArtifact(token: string) {
  cleanExpiredArtifacts();
  return artifacts.get(token) ?? null;
}
