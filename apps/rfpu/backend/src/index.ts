import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes.js';

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

app.use('/api', routes);

app.listen(PORT, () => {
  console.log(`RFPU backend running on port ${PORT}`);
});
