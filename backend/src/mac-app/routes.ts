import { Router, Request, Response } from 'express';

const router = Router();

router.get('/download-url', (_req: Request, res: Response) => {
  res.json({
    url: 'https://tools.mspi.io/mac-app/download',
    installPath: '~/Applications/MSPIStorageLocator.app',
    installCommand: 'curl -fsSL https://tools.mspi.io/mac-app/install.sh | bash',
  });
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', app: 'mac-app' });
});

export default router;
