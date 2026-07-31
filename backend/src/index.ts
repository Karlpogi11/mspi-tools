import dotenv from 'dotenv';
import { existsSync } from 'fs';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { initDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import toolsRoutes from './routes/tools.js';
import adminRoutes from './routes/admin.js';
import { pcountRouter, pcountAdminRouter, initPcount } from './pcount/gateway.js';
import rfpuRoutes from './rfpu/routes.js';

const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

dotenv.config({ path: path.resolve(_dirname, '.env'), override: true });
dotenv.config({ override: true });

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api', toolsRoutes);
app.use('/api/admin', adminRoutes);

const tools = [
  { name: 'pcount', router: pcountRouter, hasGateway: true, init: initPcount },
  { name: 'rfpu', router: rfpuRoutes, hasGateway: false },
];

for (const tool of tools) {
  app.use(`/api/${tool.name}`, tool.router);
}

app.use('/api/pcount/admin', pcountAdminRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'gateway' });
});

const publicDir = path.resolve(_dirname, 'public');

const oneYear = 365 * 24 * 60 * 60 * 1000;

const assetsDir = path.join(publicDir, 'assets');
if (existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir, { maxAge: oneYear, immutable: true }));
}

for (const tool of tools) {
  const toolDist = path.resolve(publicDir, tool.name);
  const toolIndex = path.join(toolDist, 'index.html');
  if (existsSync(toolIndex)) {
    app.use(`/${tool.name}`, express.static(toolDist, { maxAge: oneYear, immutable: true }));
    app.get(`/${tool.name}/*`, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(toolIndex);
    });
  }
}

app.use(express.static(publicDir, {
  maxAge: oneYear,
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

const frontendIndex = path.join(publicDir, 'index.html');
if (existsSync(frontendIndex)) {
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(frontendIndex);
  });
}

async function start() {
  try {
    await initDb();
    console.log('Database connected');
  } catch (error) {
    console.warn('Database unavailable — API routes requiring DB will return errors');
    console.warn('Update DATABASE_URL in backend/.env and restart');
  }

  for (const tool of tools) {
    if (tool.init) {
      await tool.init(server);
    }
  }

  server.listen(PORT, () => {
    console.log(`Gateway running on port ${PORT}`);
  });
}

start();
