import { Router, Request, Response } from 'express';
import { authenticateToken } from '../auth.js';

const router = Router();

router.use(authenticateToken);

router.get('/download-url', (_req: Request, res: Response) => {
  res.json({
    url: 'https://github.com/Karlpogi11/LabelMerger/releases/latest/download/LabelMerger-macOS.zip',
    installPath: '~/Applications/LabelMerger.app',
    installCommand: 'curl -fsSL https://raw.githubusercontent.com/Karlpogi11/LabelMerger/main/install.sh | bash',
  });
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', app: 'label-merger' });
});

export default router;
