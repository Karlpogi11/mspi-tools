import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDb } from '@mspi/shared-db';
import authRoutes from './routes/auth';
import toolsRoutes from './routes/tools';
import adminRoutes from './routes/admin';

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
