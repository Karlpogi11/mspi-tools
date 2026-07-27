import 'dotenv/config';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pcountRouter, initPcount } from './gateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;
const server = http.createServer(app);

app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5181',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

app.use('/api/pcount', pcountRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'pcount' });
});

const frontendDist = path.resolve(__dirname, 'public');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

async function start() {
  await initPcount(server);
  server.listen(PORT, () => {
    console.log(`PCount backend running on port ${PORT}`);
  });
}

start();
