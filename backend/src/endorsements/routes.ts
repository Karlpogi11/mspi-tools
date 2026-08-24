import { Router, Request, Response } from 'express';
import { getDbPool } from '../db/index.js';
import { authenticateToken } from '../auth.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureFrontlineTables } from '../frontline/store.js';

const router = Router();
router.use(authenticateToken);

function text(value: unknown) { return String(value ?? '').trim(); }
function todayManila() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); }
function isEngineer(req: Request) { return req.user?.roleName === 'ENGR'; }
function canEndorse(req: Request) { return req.user?.roleName === 'Admin' || req.user?.roleName === 'CSO'; }
function canView(req: Request) { return canEndorse(req) || canManageRoster(req) || isEngineer(req); }
function canManageRoster(req: Request) { return req.user?.roleName === 'Admin' || req.user?.roleName === 'PMG'; }
function forbidden(res: Response) { res.status(403).json({ error: 'Engineer Endorsements access required' }); }

router.post('/availability/join', async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  const [userRows] = await pool.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user!.userId]);
  const engineerName = text((userRows as Array<{ full_name: string }>)[0]?.full_name || req.user!.email);
  const [existing] = await pool.query('SELECT id FROM engineer_daily_availability WHERE user_id = ? AND availability_date = ? LIMIT 1', [req.user!.userId, todayManila()]);
  if ((existing as Array<Record<string, unknown>>).length) await pool.execute("UPDATE engineer_daily_availability SET status = 'active', left_at = NULL WHERE id = ?", [Number((existing as Array<Record<string, unknown>>)[0].id)]);
  else await pool.execute(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status, left_at) VALUES (?, ?, ?, 'active', NULL)`, [req.user!.userId, engineerName, todayManila()]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_joined', resourceType: 'engineer_daily_availability', metadata: { date: todayManila() } });
  res.json({ message: 'You are available for endorsements today.' });
});

router.post('/availability/leave', async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  await getDbPool().execute('UPDATE engineer_daily_availability SET status = \'left\', left_at = CURRENT_TIMESTAMP WHERE user_id = ? AND availability_date = ?', [req.user!.userId, todayManila()]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_left', resourceType: 'engineer_daily_availability', metadata: { date: todayManila() } });
  res.json({ message: 'You are no longer available for new endorsements today.' });
});

router.post('/availability/skip', async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const [result] = await getDbPool().execute('UPDATE engineer_daily_availability SET last_assigned_at = CURRENT_TIMESTAMP WHERE user_id = ? AND availability_date = ? AND status = \'active\'', [req.user!.userId, todayManila()]);
  if (!Number((result as { affectedRows?: number }).affectedRows)) { res.status(409).json({ error: 'Join today\'s queue before skipping your turn.' }); return; }
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_skipped', resourceType: 'engineer_daily_availability', metadata: { date: todayManila() } });
  res.json({ message: 'Your next turn was skipped. The next available Engineer is now up.' });
});

router.post('/availability/add', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  const name = text(req.body?.name); if (!name || name.length > 150) { res.status(400).json({ error: 'Engineer name is required.' }); return; }
  await ensureFrontlineTables(); const pool = getDbPool();
  await pool.execute(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status) VALUES (NULL, ?, ?, 'active') ON DUPLICATE KEY UPDATE status = 'active', left_at = NULL`, [name, todayManila()]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_added', resourceType: 'engineer_daily_availability', metadata: { name, date: todayManila() } });
  res.json({ message: `${name} is available for endorsements today.` });
});

router.post('/availability/remove', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  const id = Number(req.body?.id); if (!id) { res.status(400).json({ error: 'Engineer card is required.' }); return; }
  await ensureFrontlineTables(); const pool = getDbPool(); await pool.execute("UPDATE engineer_daily_availability SET status = 'left', left_at = CURRENT_TIMESTAMP WHERE id = ? AND availability_date = ?", [id, todayManila()]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_removed', resourceType: 'engineer_daily_availability', resourceId: String(id), metadata: { date: todayManila() } });
  res.json({ message: 'Engineer removed from today’s queue.' });
});

router.get('/available', async (req, res) => {
  if (!canEndorse(req) && !canManageRoster(req) && !isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.status, a.assignment_count, a.joined_at, a.last_assigned_at
    FROM engineer_daily_availability a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.availability_date = ?
    ORDER BY a.status = 'active' DESC, a.assignment_count ASC, a.last_assigned_at IS NOT NULL ASC, a.last_assigned_at ASC, a.joined_at ASC, a.id ASC`, [todayManila()]);
  const roster = rows as Array<Record<string, unknown>>;
  const engineers = roster.filter((engineer) => engineer.status === 'active');
  res.json({ date: todayManila(), engineers, roster, nextEngineer: engineers[0] || null });
});

router.post('/', async (req, res) => {
  if (!canEndorse(req)) { forbidden(res); return; }
  const arNumber = text(req.body?.arNumber); const deviceModelOverride = text(req.body?.deviceModel); const recordId = Number(req.body?.frontlineRecordId) || null;
  if (!arNumber) { res.status(400).json({ error: 'AR number is required.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query(`SELECT e.id, e.ar_number, e.status, u.full_name AS engineer_name FROM engineer_endorsements e INNER JOIN users u ON u.id = e.engineer_user_id WHERE e.ar_number = ? FOR UPDATE`, [arNumber]);
    if ((existingRows as Array<Record<string, unknown>>).length) { await connection.rollback(); res.status(409).json({ error: `AR ${arNumber} has already been endorsed to ${(existingRows as Array<Record<string, unknown>>)[0].engineer_name}.` }); return; }
    const [recordRows] = await connection.query(`SELECT id, ar_number, device_model, serial_number, issue, product_division FROM frontline_records WHERE ${recordId ? 'id = ?' : 'ar_number = ?'} ORDER BY id DESC LIMIT 1`, [recordId || arNumber]);
    const record = (recordRows as Array<Record<string, unknown>>)[0];
    if (!record) { await connection.rollback(); res.status(404).json({ error: 'Frontline record not found for this AR number.' }); return; }
    const [engineerRows] = await connection.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.assignment_count FROM engineer_daily_availability a WHERE a.availability_date = ? AND a.status = 'active' ORDER BY a.assignment_count ASC, a.last_assigned_at IS NOT NULL ASC, a.last_assigned_at ASC, a.joined_at ASC, a.id ASC FOR UPDATE`, [todayManila()]);
    const engineer = (engineerRows as Array<Record<string, unknown>>)[0];
    if (!engineer) { await connection.rollback(); res.status(409).json({ error: 'No Engineer is available today. Ask an Engineer to join the morning availability list.' }); return; }
    const engineerId = engineer.user_id == null ? null : Number(engineer.user_id); const availabilityId = Number(engineer.id); const sourceRecordId = Number(record.id); const engineerName = text(engineer.full_name);
    await connection.execute(`INSERT INTO engineer_endorsements (ar_number, frontline_record_id, cso_user_id, engineer_user_id, engineer_name, device_model, issue, product_division) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [arNumber, sourceRecordId, req.user!.userId, engineerId, engineerName, deviceModelOverride || text(record.device_model), text(record.issue), text(record.product_division)]);
    await connection.execute(`UPDATE engineer_daily_availability SET assignment_count = assignment_count + 1, last_assigned_at = CURRENT_TIMESTAMP WHERE id = ?`, [availabilityId]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsed', resourceType: 'engineer_endorsement', resourceId: arNumber, metadata: { engineerUserId: engineerId, productDivision: text(record.product_division) } });
    res.status(201).json({ message: `AR ${arNumber} endorsed to ${engineerName}.`, engineer: { userId: engineerId, name: engineerName }, record: { arNumber, deviceModel: deviceModelOverride || text(record.device_model), issue: text(record.issue), productDivision: text(record.product_division) } });
  } catch (error) { await connection.rollback(); console.error('endorsement error:', error); res.status(500).json({ error: 'Unable to endorse this record.' }); } finally { connection.release(); }
});

router.get('/dashboard', async (req, res) => {
  if (!canView(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const engineerId = isEngineer(req) ? req.user!.userId : Number(req.query.engineerUserId) || null;
  const [availabilityRows] = await pool.query(`SELECT user_id, status, joined_at, left_at, assignment_count FROM engineer_daily_availability WHERE availability_date = ? ${engineerId ? 'AND user_id = ?' : ''}`, engineerId ? [todayManila(), engineerId] : [todayManila()]);
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total, SUM(status = 'endorsed') AS pending FROM engineer_endorsements ${engineerId ? 'WHERE engineer_user_id = ?' : ''}`, engineerId ? [engineerId] : []);
  const [divisionRows] = await pool.query(`SELECT product_division, COUNT(*) AS total FROM engineer_endorsements ${engineerId ? 'WHERE engineer_user_id = ?' : ''} GROUP BY product_division ORDER BY total DESC`, engineerId ? [engineerId] : []);
  const [endorsementRows] = await pool.query(`SELECT e.id, e.ar_number, e.device_model, e.issue, e.product_division, e.status, e.created_at, e.engineer_name FROM engineer_endorsements e ${engineerId ? 'WHERE e.engineer_user_id = ? OR (e.engineer_user_id IS NULL AND e.engineer_name = (SELECT engineer_name FROM engineer_daily_availability WHERE user_id = ? ORDER BY id DESC LIMIT 1))' : ''} ORDER BY e.created_at DESC LIMIT 100`, engineerId ? [engineerId, engineerId] : []);
  res.json({ date: todayManila(), availability: (availabilityRows as Array<Record<string, unknown>>)[0] || null, totals: (countRows as Array<Record<string, unknown>>)[0] || { total: 0, pending: 0 }, divisions: divisionRows, endorsements: endorsementRows });
});

export default router;
