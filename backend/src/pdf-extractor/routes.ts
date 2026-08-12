import { Router, Request, Response } from 'express';
import { authenticateToken } from '../auth.js';
import { listAwbLog } from './store.js';
import { mapLimit, processPdfFile, upload, type ProcessResult } from './runner.js';
import { createDownloadArtifact, getDownloadArtifact } from './downloads.js';

const router = Router();

router.use(authenticateToken);

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
      const download = await createDownloadArtifact(results);
      res.json({ results, download });
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
      const download = await createDownloadArtifact(results);
      res.write(`${JSON.stringify({ type: 'complete', results, download })}\n`);
      res.end();
    } catch (streamErr) {
      console.error('[pdf-extractor] stream extract error:', streamErr);
      res.write(`${JSON.stringify({ type: 'error', error: (streamErr as Error)?.message || 'Failed to process files' })}\n`);
      res.end();
    }
  });
});

router.get('/download/:token', (req: Request, res: Response) => {
  const artifact = getDownloadArtifact(req.params.token);
  if (!artifact) {
    res.status(404).json({ error: 'Download expired or not found' });
    return;
  }
  res.download(artifact.path, artifact.name);
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
