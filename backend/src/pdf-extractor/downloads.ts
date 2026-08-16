import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ZipArchive } from 'archiver';
import { DATA_DIR, DOWNLOADS } from './paths.js';
import type { ProcessResult } from './runner.js';

interface DownloadArtifact {
  path: string;
  name: string;
  createdAt: number;
  originalName?: string;
}

interface ProcessingRun {
  userId: number;
  results: ProcessResult[];
  createdAt: number;
}

interface ProcessingBatchFile {
  name: string;
  size: number;
}

interface ProcessingBatch {
  version: 1;
  userId: number;
  runId: string;
  batchId: string;
  batchNumber: number;
  files: ProcessingBatchFile[];
  results: Array<ProcessResult | null>;
  createdAt: number;
  updatedAt: number;
}

interface UploadedBatchFile {
  originalname: string;
  size: number;
  path: string;
}

const artifacts = new Map<string, DownloadArtifact>();
const processingRuns = new Map<string, ProcessingRun>();
const activeBatches = new Map<string, Promise<ProcessResult[]>>();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RUNS = path.join(DATA_DIR, 'runs');

function safeRunPart(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function batchFilePath(runId: string, batchId: string) {
  return path.join(RUNS, safeRunPart(runId, 'run ID'), `${safeRunPart(batchId, 'batch ID')}.json`);
}

function writeBatch(batch: ProcessingBatch) {
  const filePath = batchFilePath(batch.runId, batch.batchId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(batch), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function readBatch(runId: string, batchId: string): ProcessingBatch | null {
  const filePath = batchFilePath(runId, batchId);
  if (!fs.existsSync(filePath)) return null;
  const batch = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProcessingBatch;
  if (batch.version !== 1 || batch.runId !== runId || batch.batchId !== batchId) {
    throw new Error('Invalid saved PDF batch');
  }
  return batch;
}

function matchingFiles(expected: ProcessingBatchFile[], received: UploadedBatchFile[]) {
  return expected.length === received.length && expected.every((file, index) =>
    file.name === path.basename(received[index].originalname) && file.size === received[index].size
  );
}

function removeUpload(filePath: string) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Multer cleanup is best-effort; a later cleanup can remove abandoned uploads.
  }
}

function cleanExpiredRuns() {
  if (!fs.existsSync(RUNS)) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of fs.readdirSync(RUNS)) {
    const dir = path.join(RUNS, name);
    try {
      if (fs.statSync(dir).isDirectory() && fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore a concurrently finalized or already removed run.
    }
  }
}

function cleanExpiredArtifacts() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [token, artifact] of artifacts) {
    if (artifact.createdAt >= cutoff) continue;
    if (artifact.path.startsWith(DOWNLOADS)) fs.rmSync(artifact.path, { force: true });
    artifacts.delete(token);
  }
  for (const [runId, run] of processingRuns) {
    if (run.createdAt < cutoff) processingRuns.delete(runId);
  }
  cleanExpiredRuns();
}

/**
 * Runs a client batch exactly once per file position, even when the browser
 * reconnects after a proxy timeout. Every completed file is atomically saved
 * before the next one starts, and duplicate requests join the same work.
 */
export async function processResumableBatch(
  runId: string,
  batchId: string,
  batchNumber: number,
  userId: number,
  files: UploadedBatchFile[],
  processFile: (file: UploadedBatchFile) => Promise<ProcessResult>,
  onProgress: (completed: number, file: string) => void,
): Promise<ProcessResult[]> {
  cleanExpiredArtifacts();
  if (!Number.isInteger(batchNumber) || batchNumber < 0) throw new Error('Invalid batch number');
  const key = `${userId}:${safeRunPart(runId, 'run ID')}:${safeRunPart(batchId, 'batch ID')}`;
  const existing = activeBatches.get(key);
  if (existing) {
    try {
      const results = await existing;
      results.forEach((result, index) => onProgress(index + 1, result.file));
      return results;
    } finally {
      files.forEach((file) => removeUpload(file.path));
    }
  }

  const work = (async () => {
    let batch = readBatch(runId, batchId);
    if (batch) {
      if (batch.userId !== userId || batch.batchNumber !== batchNumber || !matchingFiles(batch.files, files)) {
        throw new Error('Saved batch does not match this upload. Start a new extraction run.');
      }
    } else {
      batch = {
        version: 1,
        userId,
        runId,
        batchId,
        batchNumber,
        files: files.map((file) => ({ name: path.basename(file.originalname), size: file.size })),
        results: Array(files.length).fill(null),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      writeBatch(batch);
    }

    let completed = 0;
    for (let index = 0; index < files.length; index += 1) {
      const saved = batch.results[index];
      if (saved) {
        completed += 1;
        removeUpload(files[index].path);
        onProgress(completed, saved.file);
        continue;
      }
      const result = await processFile(files[index]);
      batch.results[index] = result;
      batch.updatedAt = Date.now();
      writeBatch(batch);
      completed += 1;
      onProgress(completed, result.file);
    }
    return batch.results as ProcessResult[];
  })();
  activeBatches.set(key, work);
  try {
    return await work;
  } finally {
    activeBatches.delete(key);
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

export function createFileArtifact(filePath: string, name: string, originalName?: string) {
  cleanExpiredArtifacts();
  const token = randomUUID();
  artifacts.set(token, { path: filePath, name, originalName, createdAt: Date.now() });
  return { url: `/api/pdf-extractor/file/${token}`, retryUrl: `/api/pdf-extractor/retry/${token}` };
}

export function appendProcessingRun(runId: string, userId: number, results: ProcessResult[]) {
  cleanExpiredArtifacts();
  const run = processingRuns.get(runId);
  if (run && run.userId === userId) {
    run.results.push(...results);
    run.createdAt = Date.now();
    return;
  }
  processingRuns.set(runId, { userId, results: [...results], createdAt: Date.now() });
}

export async function finalizeProcessingRun(runId: string, userId: number) {
  cleanExpiredArtifacts();
  const runDir = path.join(RUNS, safeRunPart(runId, 'run ID'));
  if (fs.existsSync(runDir)) {
    const batches = fs.readdirSync(runDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8')) as ProcessingBatch)
      .filter((batch) => batch.version === 1 && batch.runId === runId);
    if (batches.length > 0) {
      if (batches.some((batch) => batch.userId !== userId || batch.results.some((result) => result === null))) return null;
      const results = batches
        .sort((a, b) => a.batchNumber - b.batchNumber)
        .flatMap((batch) => batch.results as ProcessResult[]);
      fs.rmSync(runDir, { recursive: true, force: true });
      return createDownloadArtifact(results);
    }
  }
  const run = processingRuns.get(runId);
  if (!run || run.userId !== userId) return null;
  processingRuns.delete(runId);
  return createDownloadArtifact(run.results);
}

export function getDownloadArtifact(token: string) {
  cleanExpiredArtifacts();
  return artifacts.get(token) ?? null;
}
