import { Router, Request, Response } from 'express';
import path from 'path';
import { authenticateToken } from '../auth.js';
import { listAwbLog } from './store.js';
import { mapLimit, processPdfFile, upload, type ProcessResult } from './runner.js';
import { appendProcessingRun, createDownloadArtifact, createFileArtifact, finalizeProcessingRun, getDownloadArtifact } from './downloads.js';

const router = Router();

router.use(authenticateToken);

function addErrorActions(results: ProcessResult[]) {
  return results.map((result) => {
    if (result.status !== 'error' || !result.dest) return result;
    const action = createFileArtifact(result.dest, path.basename(result.dest), result.file);
    return { ...result, viewUrl: action.url, retryUrl: action.retryUrl };
  });
}

router.post('/extract', (req: Request, res: Response) => {
  upload.array('files', 20)(req, res, async (err: unknown) => {
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
        2,
        (f) => processPdfFile(f.path, f.originalname, req.user?.userId ?? null)
      );
      const resultsWithActions = addErrorActions(results);
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      if (runId) appendProcessingRun(runId, req.user?.userId ?? 0, resultsWithActions);
      const download = runId ? null : await createDownloadArtifact(resultsWithActions);
      res.json({ results: resultsWithActions, download });
    } catch (uploadErr) {
      console.error('[pdf-extractor] extract error:', uploadErr);
      res.status(500).json({ error: (uploadErr as Error)?.message || 'Failed to process files' });
    }
  });
});

router.post('/extract-stream', (req: Request, res: Response) => {
  upload.array('files', 20)(req, res, async (err: unknown) => {
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
    res.flushHeaders();

    try {
      const results: ProcessResult[] = new Array(files.length);
      let next = 0;
      let completed = 0;
      async function worker() {
        while (next < files.length) {
          const index = next++;
          const file = files[index];
          results[index] = await processPdfFile(file.path, file.originalname, req.user?.userId ?? null);
          completed += 1;
          res.write(`${JSON.stringify({ type: 'progress', completed, total: files.length, file: file.originalname })}\n`);
        }
      }
      await Promise.all(Array.from({ length: Math.min(2, files.length) }, () => worker()));
      const resultsWithActions = addErrorActions(results);
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      if (runId) appendProcessingRun(runId, req.user?.userId ?? 0, resultsWithActions);
      const download = runId ? null : await createDownloadArtifact(resultsWithActions);
      res.write(`${JSON.stringify({ type: 'complete', results: resultsWithActions, download })}\n`);
      res.end();
    } catch (streamErr) {
      console.error('[pdf-extractor] stream extract error:', streamErr);
      res.write(`${JSON.stringify({ type: 'error', error: (streamErr as Error)?.message || 'Failed to process files' })}\n`);
      res.end();
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
  const artifact = getDownloadArtifact(req.params.token);
  if (!artifact) {
    res.status(404).json({ error: 'Download expired or not found' });
    return;
  }
  res.download(artifact.path, artifact.name);
});

router.get('/file/:token', (req: Request, res: Response) => {
  const artifact = getDownloadArtifact(req.params.token);
  if (!artifact) {
    res.status(404).json({ error: 'File expired or not found' });
    return;
  }
  res.type('application/pdf').sendFile(artifact.path, {
    headers: { 'Content-Disposition': `inline; filename="${artifact.name.replace(/"/g, '')}"` },
  });
});

router.post('/retry/:token', async (req: Request, res: Response) => {
  const artifact = getDownloadArtifact(req.params.token);
  if (!artifact || !artifact.originalName) {
    res.status(404).json({ error: 'Retry file expired or not found' });
    return;
  }
  try {
    const result = await processPdfFile(artifact.path, artifact.originalName, req.user?.userId ?? null);
    const results = addErrorActions([result]);
    const download = await createDownloadArtifact(results);
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

export default router;
