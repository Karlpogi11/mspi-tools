import 'dotenv/config';
import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { RequestHandler } from 'express';
import { initDb } from '@mspi/shared-db';
import { authenticateToken } from '@mspi/shared-auth';
import { setDbAvailable } from './store';
import { initWs } from './ws';
import sessionRoutes from './routes/sessions';
import productRoutes from './routes/products';

const app = express();
const PORT = process.env.PORT || 3002;
const server = http.createServer(app);
const pcountAuth: RequestHandler = process.env.NODE_ENV === 'development'
  ? (_req, _res, next) => next()
  : authenticateToken;

app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5181',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

app.use('/api/pcount', pcountAuth, sessionRoutes);
app.use('/api/pcount', pcountAuth, productRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'pcount' });
});

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

initWs(server, { allowUnauthenticated: process.env.NODE_ENV === 'development' });

async function start() {
  try {
    await initDb();
    setDbAvailable(true);
    console.log('Database connected');
  } catch (error) {
    console.warn('Database unavailable — using in-memory store (data will be lost on restart)');
    console.warn('Set DATABASE_URL in backend/.env and restart to use MySQL');
  }

  server.listen(PORT, () => {
    console.log(`PCount backend running on port ${PORT}`);
  });
}

start();
