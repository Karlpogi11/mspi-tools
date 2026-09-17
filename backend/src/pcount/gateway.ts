import { Router, RequestHandler } from 'express';
import http from 'http';
import { getDb } from '../db/index.js';
import { authenticateToken } from '../auth.js';
import { setDbAvailable } from './store.js';
import { initWs } from './ws.js';
import sessionRoutes from './routes/sessions.js';
import productRoutes from './routes/products.js';
import adminRoutes from './routes/admin.js';
import { requireAdmin } from '../auth.js';
import { isAllowedOrigin } from '../config/origins.js';

const originCheck: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'Request origin not allowed' });
    return;
  }
  next();
};

export const pcountRouter = Router();
pcountRouter.use(authenticateToken);
pcountRouter.use(originCheck);
pcountRouter.use(sessionRoutes);
pcountRouter.use(productRoutes);

export const pcountAdminRouter = Router();
pcountAdminRouter.use(authenticateToken, requireAdmin);
pcountAdminRouter.use(adminRoutes);

export async function initPcount(server: http.Server) {
  try {
    getDb();
    setDbAvailable(true);
    console.log('PCount database connected');
  } catch (error) {
    console.warn('PCount database unavailable — using in-memory store');
    console.warn('Set DATABASE_URL and restart to use MySQL');
  }
  initWs();
}
