import { createHash } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getDbPool } from '../db/index.js';
import { ensureFrontlineTables } from '../frontline/store.js';

export const DIVISIONS = ['iOS/ACCS', 'MacBook', 'iMac'] as const;
export type Division = typeof DIVISIONS[number];
export const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
export function dayBounds(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00+08:00`);
  return [start, new Date(start.getTime() + 86_400_000)];
}
export function resolveDivision(model: string, source: string): Division | null {
  if (/^MacBook\b/i.test(model.trim())) return 'MacBook';
  if (/^iMac\b/i.test(model.trim())) return 'iMac';
  if (/^(iPhone|iPad|iPod|Apple Watch|AirPods|Beats)\b/i.test(model.trim())) return 'iOS/ACCS';
  const value = source.trim().toLowerCase();
  if (value === 'macbook' || value === 'portable') return 'MacBook';
  if (value === 'imac' || value === 'desktop') return 'iMac';
  if (value.includes('accs') || ['ios', 'iphone', 'ipad', 'ipod', 'watch', 'beats', 'shuffle'].includes(value)) return 'iOS/ACCS';
  return null;
}
export class QueueError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface QueueEngineer {
  id: number;
  user_id: number | null;
  full_name: string;
  status: 'active' | 'left';
  assignment_count: number;
  last_turn: number;
  returned: number;
  joined_at: string;
  last_assigned_at: string | null;
}
export interface DivisionQueue {
  division: Division;
  countPeriod: 'day' | 'month';
  engineers: QueueEngineer[];
  nextEngineer: QueueEngineer | null;
  token: string;
}
let tablesReady: Promise<void> | null = null;
export async function ensureQueueTables() {
  await ensureFrontlineTables();
  if (!tablesReady) tablesReady = (async () => {
    const pool = getDbPool();
    // A daily guard serializes selection and mutation, including changes to availability.
    await pool.query(`CREATE TABLE IF NOT EXISTS engineer_queue_days (
      queue_date date NOT NULL PRIMARY KEY,
      initialized tinyint NOT NULL DEFAULT 0
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS engineer_queue_events (
      id bigint AUTO_INCREMENT NOT NULL PRIMARY KEY,
      queue_date date NOT NULL,
      product_division varchar(30) NOT NULL,
      availability_id bigint NOT NULL,
      endorsement_id bigint NULL,
      event_type varchar(20) NOT NULL,
      reason varchar(300) NOT NULL DEFAULT '',
      actor_user_id int NULL,
      created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY engineer_queue_endorsement_unique (endorsement_id),
      KEY engineer_queue_day_division_idx (queue_date, product_division, availability_id, id),
      CONSTRAINT engineer_queue_availability_fk FOREIGN KEY (availability_id) REFERENCES engineer_daily_availability(id),
      CONSTRAINT engineer_queue_endorsement_fk FOREIGN KEY (endorsement_id) REFERENCES engineer_endorsements(id) ON DELETE CASCADE
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS engineer_availability_schedules (
      user_id int NOT NULL PRIMARY KEY,
      rest_days varchar(80) NOT NULL DEFAULT '',
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT engineer_schedule_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS engineer_roster_schedules (
      engineer_name varchar(150) NOT NULL PRIMARY KEY,
      rest_days varchar(80) NOT NULL DEFAULT '',
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
  })().catch((error) => { tablesReady = null; throw error; });
  await tablesReady;
}

export async function lockDay(connection: PoolConnection, date: string) {
  await connection.execute('INSERT IGNORE INTO engineer_queue_days (queue_date) VALUES (?)', [date]);
  const [days] = await connection.query('SELECT initialized FROM engineer_queue_days WHERE queue_date = ? FOR UPDATE', [date]);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Manila' }).format(new Date(`${date}T00:00:00+08:00`));
  await connection.query(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status)
    SELECT r.user_id, r.engineer_name, ?, IF(FIND_IN_SET(?, COALESCE(s.rest_days, '')) > 0, 'left', 'active')
    FROM engineer_roster r LEFT JOIN engineer_roster_schedules s ON s.engineer_name = r.engineer_name WHERE r.active = 1 ORDER BY r.engineer_name
    ON DUPLICATE KEY UPDATE user_id = COALESCE(engineer_daily_availability.user_id, VALUES(user_id))`, [date, weekday]);
  if (Number((days as Array<{ initialized: number }>)[0].initialized)) return;
  // Seed each division from its actual assignments, never from the old combined counter.
  const [rows] = await connection.query(`SELECT e.id, e.device_model, e.product_division, e.created_at, a.id AS availability_id
    FROM engineer_endorsements e JOIN engineer_daily_availability a
      ON a.engineer_name = e.engineer_name AND a.availability_date = ?
    WHERE e.created_at >= ? AND e.created_at < ? ORDER BY e.created_at, e.id`, [date, ...dayBounds(date)]);
  for (const row of rows as Array<{ id: number; device_model: string; product_division: string; created_at: Date; availability_id: number }>) {
    const division = resolveDivision(row.device_model, row.product_division);
    if (division) await connection.execute(`INSERT IGNORE INTO engineer_queue_events
      (queue_date, product_division, availability_id, endorsement_id, event_type, created_at) VALUES (?, ?, ?, ?, 'assigned', ?)`,
    [date, division, row.availability_id, row.id, row.created_at]);
  }
  await connection.execute('UPDATE engineer_queue_days SET initialized = 1 WHERE queue_date = ?', [date]);
}

function isLockContention(error: unknown) {
  const code = (error as { code?: string; errno?: number })?.code;
  const errno = (error as { errno?: number })?.errno;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1213 || errno === 1205;
}

export async function withQueue<T>(work: (connection: PoolConnection, date: string) => Promise<T>, syncCounts = true): Promise<T> {
  await ensureQueueTables();
  const date = todayManila();
  // Concurrent queue operations (polling + arrange/assign/skip) contend on the
  // daily guard row. A deadlock victim must retry instead of surfacing a 500.
  for (let attempt = 0; ; attempt++) {
    const connection = await getDbPool().getConnection();
    try {
      await connection.beginTransaction();
      await lockDay(connection, date);
      const result = await work(connection, date);
      if (syncCounts) {
        await connection.query(`UPDATE engineer_daily_availability a LEFT JOIN (
          SELECT availability_id, COUNT(endorsement_id) AS total, MAX(created_at) AS last_assignment
          FROM engineer_queue_events WHERE queue_date = ? GROUP BY availability_id
        ) e ON e.availability_id = a.id
          SET a.assignment_count = COALESCE(e.total, 0), a.last_assigned_at = e.last_assignment
          WHERE a.availability_date = ?`, [date, date]);
      }
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (error instanceof QueueError || !isLockContention(error) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1) + Math.floor(Math.random() * 50)));
    } finally { connection.release(); }
  }
}

export async function divisionQueue(connection: PoolConnection, date: string, division: Division): Promise<DivisionQueue> {
  const countPeriod = division === 'iOS/ACCS' ? 'day' : 'month';
  // Yesterday (Manila): active today after being away yesterday = back from rest.
  const prevDate = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - 86_400_000).toISOString().slice(0, 10);
  if (countPeriod === 'month') {
    const monthStart = `${date.slice(0, 7)}-01`;
    const monthEndDate = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1));
    const monthEnd = `${monthEndDate.getUTCFullYear()}-${String(monthEndDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const [rows] = await connection.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.status, a.joined_at,
      COALESCE(turns.last_turn, 0) AS last_turn, COALESCE(monthly.total, 0) AS assignment_count, monthly.last_assigned_at,
      COALESCE(prev.status = 'left', 0) AS returned
      FROM engineer_daily_availability a
      LEFT JOIN (SELECT engineer_name, COUNT(*) AS total, MAX(created_at) AS last_assigned_at FROM engineer_endorsements
        WHERE created_at >= ? AND created_at < ? AND product_division = ? GROUP BY engineer_name) monthly ON monthly.engineer_name = a.engineer_name
      LEFT JOIN (SELECT prior.engineer_name, MAX(e.id) AS last_turn FROM engineer_queue_events e
        JOIN engineer_daily_availability prior ON prior.id = e.availability_id
        WHERE e.queue_date >= ? AND e.queue_date < ? AND e.product_division = ? GROUP BY prior.engineer_name) turns ON turns.engineer_name = a.engineer_name
      LEFT JOIN engineer_daily_availability prev ON prev.engineer_name = a.engineer_name AND prev.availability_date = ?
      WHERE a.availability_date = ? AND EXISTS (SELECT 1 FROM engineer_roster r WHERE r.active = 1 AND r.engineer_name = a.engineer_name)
      ORDER BY COALESCE(monthly.total, 0), COALESCE(prev.status = 'left', 0) DESC, COALESCE(turns.last_turn, 0), a.joined_at, a.id`, [dayBounds(monthStart)[0], dayBounds(monthEnd)[0], division, monthStart, dayBounds(monthEnd)[0], division, prevDate, date]);
    const roster = (rows as QueueEngineer[]).map((row) => ({ ...row, id: Number(row.id), user_id: row.user_id == null ? null : Number(row.user_id), assignment_count: Number(row.assignment_count), last_turn: Number(row.last_turn), returned: Number(row.returned) }));
    const engineers = roster.filter((row) => row.status === 'active');
    const token = createHash('sha256').update(JSON.stringify([date, division, countPeriod, roster.map((row) => [row.id, row.full_name, row.status, row.last_turn, row.assignment_count, row.returned])])).digest('hex');
    return { division, countPeriod, engineers, nextEngineer: engineers[0] || null, token };
  }
  const [rows] = await connection.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.status, a.joined_at,
    COALESCE(e.last_turn, 0) AS last_turn, COALESCE(e.total, 0) AS assignment_count, e.last_assignment AS last_assigned_at,
    COALESCE(prev.status = 'left', 0) AS returned
    FROM engineer_daily_availability a LEFT JOIN (
      SELECT availability_id, MAX(id) AS last_turn, COUNT(endorsement_id) AS total,
        MAX(created_at) AS last_assignment
      FROM engineer_queue_events WHERE queue_date = ? AND product_division = ? GROUP BY availability_id
    ) e ON e.availability_id = a.id
    LEFT JOIN engineer_daily_availability prev ON prev.engineer_name = a.engineer_name AND prev.availability_date = ?
    WHERE a.availability_date = ? AND EXISTS (SELECT 1 FROM engineer_roster r WHERE r.active = 1 AND r.engineer_name = a.engineer_name)
    ORDER BY COALESCE(e.total, 0), COALESCE(prev.status = 'left', 0) DESC, COALESCE(e.last_turn, 0), a.joined_at, a.id`, [date, division, prevDate, date]);
  const roster = (rows as QueueEngineer[]).map((row) => ({ ...row, id: Number(row.id), user_id: row.user_id == null ? null : Number(row.user_id), assignment_count: Number(row.assignment_count), last_turn: Number(row.last_turn), returned: Number(row.returned) }));
  const engineers = roster.filter((row) => row.status === 'active');
  const token = createHash('sha256').update(JSON.stringify([date, division, roster.map((row) => [row.id, row.full_name, row.status, row.last_turn, row.assignment_count, row.returned])])).digest('hex');
  return { division, countPeriod, engineers, nextEngineer: engineers[0] || null, token };
}

export function requireCurrentQueue(queue: DivisionQueue, token: unknown) {
  if (typeof token !== 'string' || token !== queue.token) throw new QueueError(409, 'The queue changed. Review the next Engineer again before confirming.');
  if (!queue.nextEngineer) throw new QueueError(409, `No Engineer is available for ${queue.division}.`);
  return queue.nextEngineer;
}

export async function recordTurn(connection: PoolConnection, date: string, division: Division, availabilityId: number, endorsementId: number | null, actorUserId: number, reason = '') {
  await connection.execute(`INSERT INTO engineer_queue_events
    (queue_date, product_division, availability_id, endorsement_id, event_type, actor_user_id, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [date, division, availabilityId, endorsementId, endorsementId === null ? 'skipped' : 'assigned', actorUserId, reason]);
}

export async function readQueues() {
  await ensureQueueTables();
  const pool = getDbPool();
  const date = todayManila();
  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM engineer_daily_availability WHERE availability_date = ?', [date]);
  if (!Number((countRows as Array<{ total: number }>)[0]?.total)) return availableQueues();
  const connection = await pool.getConnection();
  try {
    const queues: DivisionQueue[] = [];
    for (const division of DIVISIONS) queues.push(await divisionQueue(connection, date, division));
    const [roster] = await connection.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.status, a.joined_at,
      (SELECT COUNT(endorsement_id) FROM engineer_queue_events e WHERE e.availability_id = a.id AND e.queue_date = ?) AS assignment_count
      FROM engineer_daily_availability a WHERE a.availability_date = ?
      AND EXISTS (SELECT 1 FROM engineer_roster r WHERE r.active = 1 AND r.engineer_name = a.engineer_name)
      ORDER BY a.engineer_name, a.id`, [date, date]);
    const [skips] = await connection.query(`SELECT e.id, e.product_division AS division, a.engineer_name, e.reason, e.created_at
      FROM engineer_queue_events e JOIN engineer_daily_availability a ON a.id = e.availability_id
      WHERE e.queue_date = ? AND e.event_type = 'skipped' ORDER BY e.id DESC LIMIT 6`, [date]);
    return { date, queues, roster, skips };
  } finally { connection.release(); }
}

export async function availableQueues() {
  return withQueue(async (connection, date) => {
    const queues: DivisionQueue[] = [];
    for (const division of DIVISIONS) queues.push(await divisionQueue(connection, date, division));
    const [roster] = await connection.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.status, a.joined_at,
      (SELECT COUNT(endorsement_id) FROM engineer_queue_events e WHERE e.availability_id = a.id AND e.queue_date = ?) AS assignment_count
      FROM engineer_daily_availability a WHERE a.availability_date = ?
      AND EXISTS (SELECT 1 FROM engineer_roster r WHERE r.active = 1 AND r.engineer_name = a.engineer_name)
      ORDER BY a.engineer_name, a.id`, [date, date]);
    const [skips] = await connection.query(`SELECT e.id, e.product_division AS division, a.engineer_name, e.reason, e.created_at
      FROM engineer_queue_events e JOIN engineer_daily_availability a ON a.id = e.availability_id
      WHERE e.queue_date = ? AND e.event_type = 'skipped' ORDER BY e.id DESC LIMIT 6`, [date]);
    return { date, queues, roster, skips };
  }, false);
}
