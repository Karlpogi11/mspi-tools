import { Router } from 'express';
import { authenticateToken } from '@mspi/shared-auth';

const router = Router();

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'rfpu' });
});

export default router;
