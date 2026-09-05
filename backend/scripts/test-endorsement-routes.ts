import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { initDb, getDbPool } from '../src/db/index.js';
import endorsementRoutes from '../src/endorsements/routes.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  process.env.DATABASE_URL ||= 'mysql://root@127.0.0.1:33317/mspi_queue_test';
  process.env.JWT_SECRET = 'queue-integration-secret';
  await initDb();
  const pool = getDbPool();
  await pool.query('CREATE TABLE IF NOT EXISTS roles (id int AUTO_INCREMENT PRIMARY KEY, name varchar(50) NOT NULL UNIQUE)');
  await pool.execute("INSERT IGNORE INTO roles (id, name) VALUES (1, 'Admin')");
  await pool.execute('UPDATE users SET role_id = 1 WHERE id = 1');
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id int AUTO_INCREMENT PRIMARY KEY, actor_user_id int NULL, action varchar(100) NOT NULL,
    resource_type varchar(100) NOT NULL, resource_id varchar(255) NULL, metadata text NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const app = express();
  app.use(express.json()); app.use(cookieParser()); app.use('/api/endorsements', endorsementRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object', 'test server did not start');
  const token = jwt.sign({ userId: 1, email: 'queue-admin@example.test', roleId: 1, roleName: 'Admin', isSuperAdmin: true, tokenVersion: 0 }, process.env.JWT_SECRET);
  const request = async (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${address.port}/api/endorsements${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, ...init?.headers },
  });
  try {
    const available = await request('/available');
    assert(available.status === 200, `available route returned ${available.status}`);
    const availableBody = await available.json() as { queues: Array<{ division: string; token: string }> };
    assert(availableBody.queues.length === 3, 'available route did not return three queues');

    const preview = await request('/preview', { method: 'POST', body: JSON.stringify({ arNumber: 'QUEUE-TEST-IOS-4' }) });
    assert(preview.status === 200, `preview route returned ${preview.status}`);
    const previewBody = await preview.json() as { queue: { token: string; nextEngineer: { full_name: string } } };

    const missingReview = await request('/', { method: 'POST', body: JSON.stringify({ arNumber: 'QUEUE-TEST-IOS-4' }) });
    assert(missingReview.status === 409, 'assignment route accepted an AR without a reviewed queue token');
    const created = await request('/', { method: 'POST', body: JSON.stringify({ arNumber: 'QUEUE-TEST-IOS-4', queueToken: previewBody.queue.token }) });
    assert(created.status === 201, `assignment route returned ${created.status}`);
    const createdBody = await created.json() as { engineer: { name: string } };
    assert(createdBody.engineer.name === previewBody.queue.nextEngineer.full_name, 'assignment did not use the reviewed next Engineer');
    const duplicate = await request('/preview', { method: 'POST', body: JSON.stringify({ arNumber: 'QUEUE-TEST-IOS-4' }) });
    assert(duplicate.status === 409, 'duplicate AR preview was not rejected');

    const invalidSkip = await request('/availability/pass-next', { method: 'POST', body: JSON.stringify({ division: 'iOS/ACCS', reason: '', queueToken: 'invalid' }) });
    assert(invalidSkip.status === 400, 'skip route accepted a missing reason');
    console.log('PASS: HTTP availability, preview, reviewed assignment, duplicate, and skip validation');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
}

run().catch(async (error) => { console.error(error); await getDbPool().end().catch(() => undefined); process.exitCode = 1; });
