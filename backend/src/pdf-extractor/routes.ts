import { Router, Request, Response } from 'express';
import { authenticateToken } from '../auth.js';
import { listAwbLog } from './store.js';
import { mapLimit, processPdfFile, upload, type ProcessResult } from './runner.js';

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
      res.json({ results });
    } catch (uploadErr) {
      console.error('[pdf-extractor] extract error:', uploadErr);
      res.status(500).json({ error: (uploadErr as Error)?.message || 'Failed to process files' });
    }
  });
});

router.get('/log', async (_req: Request, res: Response) => {
  try {
    res.json(await listAwbLog(500));
  } catch (err) {
    console.error('[pdf-extractor] log error:', err);
    res.status(500).json({ error: (err as Error)?.message || 'Failed to load log' });
  }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;