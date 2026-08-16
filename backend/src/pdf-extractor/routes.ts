import { Router, Request, Response } from 'express';
import path from 'path';
import { authenticateToken, requireAdmin } from '../auth.js';
import { listAwbLog } from './store.js';
import { mapLimit, MAX_PDF_FILES_PER_REQUEST, PDF_PROCESS_CONCURRENCY, processPdfFileSafely, upload, type ProcessResult } from './runner.js';
import { appendProcessingRun, createDownloadArtifact, createFileArtifact, finalizeProcessingRun, getDownloadArtifact, getFileArtifact, processResumableBatch } from './downloads.js';
import { clearPdfDiagnostics, listPdfDiagnostics, recordPdfDiagnostic } from './diagnostics.js';

const router = Router();

router.use(authenticateToken);

function addErrorActions(results: ProcessResult[], userId: number) {
  return results.map((result) => {
    if (result.status !== 'error' || !result.dest) return result;
    const action = createFileArtifact(result.dest, path.basename(result.dest), result.file, userId);
    return { ...result, viewUrl: action.url, retryUrl: action.retryUrl };
  });
}

function recordResultDiagnostics(results: ProcessResult[], runId?: string, batchId?: string) {
  for (const result of results) {
    if (result.status !== 'error') continue;
    recordPdfDiagnostic({
      level: 'warn',
      event: 'file-needs-attention',
      message: result.reasons?.join(', ') || 'PDF extraction could not complete',
      file: result.file,
      runId,
      batchId,
    });
  }
}

router.post('/extract', (req: Request, res: Response) => {
  upload.array('files', MAX_PDF_FILES_PER_REQUEST)(req, res, async (err: unknown) => {
    if (err) {
      res.status(400).json({ error: (err as Error)?.message || 'Upload failed' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No PDF files uploaded' });
      return;
    }
    try {
      const results: ProcessResult[] = await mapLimit(
        files,
        PDF_PROCESS_CONCURRENCY,
        (f) => processPdfFileSafely(f.path, f.originalname, req.user?.userId ?? null)
      );
      const userId = req.user?.userId ?? 0;
      const resultsWithActions = addErrorActions(results, userId);
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      recordResultDiagnostics(resultsWithActions, runId || undefined);
      if (runId) appendProcessingRun(runId, req.user?.userId ?? 0, resultsWithActions);
      const download = runId ? null : await createDownloadArtifact(resultsWithActions, userId);
      res.json({ results: resultsWithActions, download });
    } catch (uploadErr) {
      console.error('[pdf-extractor] extract error:', uploadErr);
      res.status(500).json({ error: (uploadErr as Error)?.message || 'Failed to process files' });
    }
  });
});

router.post('/extract-stream', (req: Request, res: Response) => {
  upload.array('files', MAX_PDF_FILES_PER_REQUEST)(req, res, async (err: unknown) => {
    if (err) {
      res.status(400).json({ error: (err as Error)?.message || 'Upload failed' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No PDF files uploaded' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let streamFinished = false;
    res.once('close', () => {
      if (streamFinished) return;
      recordPdfDiagnostic({
        level: 'warn',
        event: 'client-disconnected',
        message: 'The browser disconnected while a PDF group was processing. Saved checkpoints remain resumable.',
      });
    });

    // Keep long OCR requests alive through reverse proxies while workers are busy.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`${JSON.stringify({ type: 'heartbeat' })}\n`);
    }, 15_000);
    heartbeat.unref();

    try {
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      const batchId = typeof req.body?.batchId === 'string' ? req.body.batchId : '';
      const batchNumber = Number(req.body?.batchNumber);
      if (!runId || !batchId || !Number.isInteger(batchNumber) || batchNumber < 0) {
        res.write(`${JSON.stringify({ type: 'error', error: 'Missing resumable batch details. Please start the extraction again.' })}\n`);
        streamFinished = true;
        res.end();
        return;
      }
      const userId = req.user?.userId ?? 0;
      const results = await processResumableBatch(
        runId,
        batchId,
        batchNumber,
        userId,
        files,
        (file) => processPdfFileSafely(file.path, file.originalname, userId),
        (completed, file) => res.write(`${JSON.stringify({ type: 'progress', completed, total: files.length, file })}\n`),
      );
      const resultsWithActions = addErrorActions(results, userId);
      recordResultDiagnostics(resultsWithActions, runId, batchId);
      const download = null;
      res.write(`${JSON.stringify({ type: 'complete', results: resultsWithActions, download })}\n`);
      streamFinished = true;
      res.end();
    } catch (streamErr) {
      console.error('[pdf-extractor] stream extract error:', streamErr);
      recordPdfDiagnostic({
        level: 'error',
        event: 'batch-processing-failed',
        message: (streamErr as Error)?.message || 'Failed to process files',
      });
      res.write(`${JSON.stringify({ type: 'error', error: (streamErr as Error)?.message || 'Failed to process files' })}\n`);
      streamFinished = true;
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  });
});

router.post('/finalize-run', async (req: Request, res: Response) => {
  const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
  if (!runId) {
    res.status(400).json({ error: 'runId is required' });
    return;
  }
  try {
    res.json({ download: await finalizeProcessingRun(runId, req.user?.userId ?? 0) });
  } catch (err) {
    console.error('[pdf-extractor] finalize run error:', err);
    res.status(500).json({ error: (err as Error)?.message || 'Failed to prepare download' });
  }
});

router.get('/download/:token', (req: Request, res: Response) => {
  const artifact = getDownloadArtifact(req.params.token, req.user?.userId ?? 0);
  if (!artifact) {
    res.status(404).json({ error: 'Download expired or not found' });
    return;
  }
  res.download(artifact.path, artifact.name);
});

router.get('/file/:token', (req: Request, res: Response) => {
  const artifact = getFileArtifact(req.params.token, req.user?.userId ?? 0);
  if (!artifact) {
    res.status(404).json({ error: 'File expired or not found' });
    return;
  }
  res.type('application/pdf').sendFile(artifact.path, {
    headers: { 'Content-Disposition': `inline; filename="${artifact.name.replace(/"/g, '')}"` },
  });
});

router.post('/retry/:token', async (req: Request, res: Response) => {
  const userId = req.user?.userId ?? 0;
  const artifact = getFileArtifact(req.params.token, userId);
  if (!artifact || !artifact.originalName) {
    res.status(404).json({ error: 'Retry file expired or not found' });
    return;
  }
  try {
    const result = await processPdfFileSafely(artifact.path, artifact.originalName, req.user?.userId ?? null);
    const results = addErrorActions([result], userId);
    const download = await createDownloadArtifact(results, userId);
    res.json({ result: results[0], download });
  } catch (err) {
    console.error('[pdf-extractor] retry error:', err);
    res.status(500).json({ error: (err as Error)?.message || 'Failed to retry file' });
  }
});

router.get('/log', async (req: Request, res: Response) => {
  try {
    res.json(await listAwbLog(req.user!.userId, 500));
  } catch (err) {
    console.error('[pdf-extractor] log error:', err);
    res.status(500).json({ error: (err as Error)?.message || 'Failed to load log' });
  }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

router.get('/diagnostics', requireAdmin, (_req: Request, res: Response) => {
  res.json(listPdfDiagnostics());
});

router.delete('/diagnostics', requireAdmin, (_req: Request, res: Response) => {
  clearPdfDiagnostics();
  res.status(204).end();
});

export default router;
