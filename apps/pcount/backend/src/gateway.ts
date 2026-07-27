import { Router, RequestHandler } from 'express';
import http from 'http';
import { initDb } from '@mspi/shared-db';
import { authenticateToken } from '@mspi/shared-auth';
import { setDbAvailable } from './store.js';
import { initWs } from './ws.js';
import sessionRoutes from './routes/sessions.js';
import productRoutes from './routes/products.js';

const pcountAuth: RequestHandler = process.env.NODE_ENV === 'development'
  ? (_req, _res, next) => next()
  : authenticateToken;

export const pcountRouter = Router();
pcountRouter.use(pcountAuth);
pcountRouter.use(sessionRoutes);
pcountRouter.use(productRoutes);

export async function initPcount(server: http.Server) {
  try {
    await initDb();
    setDbAvailable(true);
    console.log('PCount database connected');
  } catch (error) {
    console.warn('PCount database unavailable — using in-memory store');
    console.warn('Set DATABASE_URL and restart to use MySQL');
  }
  initWs(server, { allowUnauthenticated: process.env.NODE_ENV === 'development' });
}
