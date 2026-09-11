import dotenv from 'dotenv';
import { existsSync } from 'fs';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { initDb } from './db/index.js';
import { syncBuiltinToolCatalog } from './db/tool-catalog.js';
import authRoutes from './routes/auth.js';
import toolsRoutes from './routes/tools.js';
import adminRoutes from './routes/admin.js';
import { pcountRouter, pcountAdminRouter, initPcount } from './pcount/gateway.js';
import rfpuRoutes from './rfpu/routes.js';
import reformatRoutes from './reformat/routes.js';
import consumablesRoutes from './consumables/routes.js';
import pdfExtractorRoutes from './pdf-extractor/routes.js';
import { ensureAwbLogTable } from './pdf-extractor/store.js';
import { ocrPool } from './pdf-extractor/ocr.js';
import { httpLogger, logger } from './logger.js';
import applecareRoutes from './applecare/routes.js';
import { ensureApplecareTables } from './applecare/store.js';
import frontlineRoutes from './frontline/routes.js';
import { ensureFrontlineTables } from './frontline/store.js';
import endorsementRoutes from './endorsements/routes.js';
import storageLocatorRoutes from './storage-locator/routes.js';
import partsRoutes from './parts/routes.js';
import { authenticateToken, requireToolAccess } from './auth.js';

const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

// Resolve the backend environment file consistently when started from either
// backend/src (tsx) or backend/dist (compiled production build).
dotenv.config({ path: path.resolve(_dirname, '..', '.env') });
dotenv.config({ path: path.resolve(_dirname, '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
let appReady = false;
let startupError: string | null = null;

app.set('trust proxy', 1);
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

app.use(compression());
app.use(helmet());
app.use(httpLogger);
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use((req, res, next) => {
  const limit = req.path.startsWith('/api/pcount') ? '10mb' : '100kb';
  express.json({ limit })(req, res, next);
});
app.use(cookieParser());

// Shared hosting protection: normal users can still poll comfortably, while
// runaway clients and bots cannot consume the whole process pool.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});
const expensiveApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'This operation is temporarily rate limited. Please try again later.' },
});
const partsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => {
    const userId = (req as typeof req & { user?: { userId?: number } }).user?.userId;
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Parts requests are temporarily rate limited. Please wait a moment and try again.' },
});

app.use('/api', apiLimiter);
app.use('/api/frontline/sync', expensiveApiLimiter);
app.use('/api/pdf-extractor/extract', expensiveApiLimiter);
app.use('/api/pdf-extractor/extract-stream', expensiveApiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api', toolsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/frontline', frontlineRoutes);
app.use('/api/endorsements', authenticateToken, requireToolAccess('/endorsements'), endorsementRoutes);
app.use('/api/storage-locator', authenticateToken, requireToolAccess('/storage-locator'), storageLocatorRoutes);
app.use('/api/parts', authenticateToken, requireToolAccess('/parts'), partsLimiter, partsRoutes);

const tools = [
  { name: 'pcount', router: pcountRouter, hasGateway: true, init: initPcount },
  { name: 'rfpu', router: rfpuRoutes, hasGateway: false },
  { name: 'reformat', router: reformatRoutes, hasGateway: false },
  { name: 'consumables', router: consumablesRoutes, hasGateway: false },
  { name: 'pdf-extractor', router: pdfExtractorRoutes, hasGateway: false },
  { name: 'applecare', router: applecareRoutes, hasGateway: false },
];

for (const tool of tools) {
  app.use(`/api/${tool.name}`, authenticateToken, requireToolAccess(`/${tool.name}`));
  app.use(`/api/${tool.name}`, tool.router);
}

app.use('/api/pcount/admin', pcountAdminRouter);

app.get('/api/health', (_req, res) => {
  if (!appReady) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ status: startupError ? 'error' : 'starting', app: 'gateway' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
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
  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'Gateway running');
    void ocrPool.warmup()
      .then(() => logger.info('PDF Extractor OCR workers ready'))
      .catch((error) => logger.warn({ err: error }, 'PDF Extractor OCR unavailable until the next server restart'));
  });

  try {
    await initDb();
    logger.info('Database connected');
    await ensureAwbLogTable();
    logger.info('PDF Extractor log table ready');
    await ensureApplecareTables();
    logger.info('AppleCare tables ready');
    await ensureFrontlineTables();
    logger.info('Frontline tables ready');
    const { ensureStorageTables } = await import('./storage-locator/store.js');
    await ensureStorageTables();
    logger.info('Storage Locator tables ready');
    const { ensurePartsTables } = await import('./parts/store.js');
    await ensurePartsTables();
    logger.info('Parts Inventory tables ready');
    await syncBuiltinToolCatalog();
    logger.info('Built-in tool catalog synchronized');
  } catch (error) {
    startupError = 'database unavailable';
    logger.warn('Database unavailable — API routes requiring DB will return errors');
    logger.warn('Update DATABASE_URL in backend/.env and restart');
    logger.warn({ err: error }, 'Database initialization failed');
  }

  for (const tool of tools) {
    if (tool.init) {
      await tool.init(server);
    }
  }

  if (!startupError) {
    appReady = true;
    logger.info('Gateway ready');
  }
}

void start().catch((error) => {
  startupError = (error as Error).message;
  logger.error({ err: error }, 'Gateway startup failed');
});
