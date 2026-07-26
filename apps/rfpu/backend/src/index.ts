import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authenticateToken } from '@mspi/shared-auth';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5180',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'rfpu' });
});

app.listen(PORT, () => {
  console.log(`RFPU backend running on port ${PORT}`);
});
