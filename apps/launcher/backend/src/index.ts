import 'dotenv/config';
import { existsSync } from 'fs';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from '@mspi/shared-db';
import authRoutes from './routes/auth.js';
import toolsRoutes from './routes/tools.js';
import adminRoutes from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api', toolsRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const frontendDist = path.resolve(__dirname, 'public');
const frontendIndex = path.join(frontendDist, 'index.html');

if (existsSync(frontendIndex)) {
  app.use(express.static(frontendDist));
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

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();
