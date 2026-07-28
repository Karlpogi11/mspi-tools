import dotenv from 'dotenv';
dotenv.config({ override: true });
import { existsSync } from 'fs';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { initDb } from '@mspi/shared-db';
import authRoutes from './routes/auth.js';
import toolsRoutes from './routes/tools.js';
import adminRoutes from './routes/admin.js';
import { pcountRouter, initPcount } from '@mspi/pcount-backend/gateway';
import rfpuRoutes from '@mspi/rfpu-backend/routes';

const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'gateway' });
});

const publicDir = path.resolve(_dirname, 'public');

for (const tool of tools) {
  const toolDist = path.resolve(publicDir, tool.name);
  const toolIndex = path.join(toolDist, 'index.html');
  if (existsSync(toolIndex)) {
    app.use(`/${tool.name}`, express.static(toolDist));
    app.get(`/${tool.name}/*`, (_req, res) => {
      res.sendFile(toolIndex);
    });
  }
}

const frontendIndex = path.join(publicDir, 'index.html');
if (existsSync(frontendIndex)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
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
