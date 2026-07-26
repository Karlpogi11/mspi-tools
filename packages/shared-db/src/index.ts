import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle<typeof schema>>;
let pool: mysql.Pool;
let dbReady = false;

export async function initDb(databaseUrl?: string) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not provided');
  }
  pool = mysql.createPool(url);
  await pool.query('SELECT 1');
  db = drizzle(pool, { schema, mode: 'default' });
  dbReady = true;
  return db;
}

export function getDb() {
  if (!dbReady) {
    throw new Error('Database unavailable');
  }
  return db;
}

export function getDbPool() {
  if (!dbReady) {
    throw new Error('Database unavailable');
  }
  return pool;
}

export { schema };
