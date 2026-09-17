import { Router, type Request, type Response } from 'express';
import { getDbPool } from '../db/index.js';
import { authenticateToken, requireSuperAdmin } from '../auth.js';
import { sendPushToTargetUsers } from './push.js';
import { broadcastPulse } from '../messenger/ws.js';
import type { PulseCardType, PulseMessage, PulsePayload, PulseTargetRole } from './types.js';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);
const TYPES = new Set<PulseCardType>(['ENDORSE', 'RELEASE', 'PARTS_REQUEST', 'CABINET_QUERY', 'STATUS_CHECK', 'SHIFT_HANDOVER', 'ALERT']);
const ROLES = new Set<PulseTargetRole>(['ENGR', 'PMG', 'CSO', 'Admin', 'ALL']);
const text = (v: unknown) => String(v ?? '').trim();

export async function ensurePulseTables(): Promise<void> {
  const pool = getDbPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS pulse_messages (id INT AUTO_INCREMENT PRIMARY KEY, type ENUM('ENDORSE','RELEASE','PARTS_REQUEST','CABINET_QUERY','STATUS_CHECK','SHIFT_HANDOVER','ALERT') NOT NULL, ar_number VARCHAR(50) NULL, payload JSON NOT NULL, posted_by INT NULL, target_role ENUM('ENGR','PMG','CSO','Admin','ALL') NOT NULL, target_user_id INT NULL, status ENUM('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY pulse_messages_feed_idx (created_at,target_role), KEY pulse_messages_ar_idx (ar_number,created_at), FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pulse_acknowledgments (id INT AUTO_INCREMENT PRIMARY KEY, message_id INT NOT NULL, user_id INT NOT NULL, acknowledged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY pulse_ack_message_user_unique (message_id,user_id), FOREIGN KEY (message_id) REFERENCES pulse_messages(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pulse_subscriptions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device_label VARCHAR(100) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_used_at TIMESTAMP NULL, UNIQUE KEY pulse_subscriptions_user_endpoint_unique (user_id,endpoint(500)), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
}

function payloadValid(type: PulseCardType, payload: unknown): payload is PulsePayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  const required: Record<PulseCardType, string[]> = { ENDORSE: ['arNumber', 'deviceModel', 'faultDescription', 'priority', 'assignedEngineerName', 'assignedEngineerId', 'waitingHours'], RELEASE: ['arNumber', 'customerName', 'releasedByEmployeeId', 'releasedByName', 'cabinetLocation'], PARTS_REQUEST: ['arNumber', 'partNumber', 'partDescription', 'urgency', 'requestedByName', 'status'], CABINET_QUERY: [], STATUS_CHECK: ['arNumber', 'timeline'], SHIFT_HANDOVER: ['openEndorsements', 'pendingPartsRequests', 'unitsInCabinet', 'totalOpen'], ALERT: ['message', 'severity'] };
  return required[type].every((key) => p[key] !== undefined && p[key] !== null);
}

export async function postPulseCard(input: { type: PulseCardType; arNumber?: string | null; payload: PulsePayload; postedBy: number; targetRole: PulseTargetRole; targetUserId?: number | null }): Promise<PulseMessage> {
  const pool = getDbPool();
  const [result] = await pool.execute('INSERT INTO pulse_messages (type, ar_number, payload, posted_by, target_role, target_user_id) VALUES (?, ?, ?, ?, ?, ?)', [input.type, input.arNumber || null, JSON.stringify(input.payload), input.postedBy, input.targetRole, input.targetUserId || null]);
  const id = Number((result as { insertId: number }).insertId);
  const [rows] = await pool.query('SELECT * FROM pulse_messages WHERE id = ?', [id]);
  const message = (rows as Array<Record<string, unknown>>)[0] as unknown as PulseMessage;
  void sendPushToTargetUsers(message);
  broadcastPulse({ type: 'pulse:new', message });
  return message;
}

function roleWhere(userId: number, roleName: string | null, isSuperAdmin: boolean): { sql: string; params: Array<number | string> } {
  if (isSuperAdmin || roleName === 'Admin') return { sql: '1=1', params: [] };
  if (roleName === 'ENGR') return { sql: '(m.target_role IN (\'ENGR\', \'ALL\') OR m.target_user_id = ?)', params: [userId] };
  return { sql: '(m.target_role IN (?, \'ALL\'))', params: [roleName || ''] };
}

router.get('/feed', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const where = roleWhere(req.user!.userId, req.user!.roleName, req.user!.isSuperAdmin); const clauses = [where.sql]; const params: Array<number | string> = [...where.params];
  if (TYPES.has(text(req.query.type) as PulseCardType)) { clauses.push('m.type = ?'); params.push(text(req.query.type)); }
  if (text(req.query.arNumber)) { clauses.push('m.ar_number = ?'); params.push(text(req.query.arNumber)); }
  const pool = getDbPool(); const offset = (page - 1) * limit;
  const [rows] = await pool.query(`SELECT m.*, u.full_name AS posted_by_name, IF(a.id IS NULL, 0, 1) AS isAcknowledged FROM pulse_messages m LEFT JOIN users u ON u.id = m.posted_by LEFT JOIN pulse_acknowledgments a ON a.message_id = m.id AND a.user_id = ? WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, [req.user!.userId, ...params, limit, offset]);
  const [unread] = await pool.query(`SELECT COUNT(*) AS total FROM pulse_messages m LEFT JOIN pulse_acknowledgments a ON a.message_id = m.id AND a.user_id = ? WHERE ${clauses.join(' AND ')} AND a.id IS NULL AND m.status <> 'RESOLVED'`, [req.user!.userId, ...params]);
  res.setHeader('X-Pulse-Unread', String(Number((unread as Array<{ total: number }>)[0]?.total || 0))); res.json({ cards: rows });
});

router.post('/message', async (req, res) => {
  const type = text(req.body?.type) as PulseCardType; const arNumber = text(req.body?.arNumber) || null; const payload = req.body?.payload;
  if (!TYPES.has(type) || !payloadValid(type, payload)) { res.status(400).json({ error: 'Card type and payload do not match.' }); return; }
  if (['ENDORSE', 'RELEASE', 'PARTS_REQUEST'].includes(type)) { const [found] = await getDbPool().query('SELECT id FROM frontline_records WHERE ar_number = ? LIMIT 1', [arNumber || text((payload as { arNumber?: string }).arNumber)]); if (!(found as unknown[]).length) { res.status(404).json({ error: 'Frontline record not found for this AR number.' }); return; } }
  const targetRole = (text(req.body?.targetRole) || (type === 'ENDORSE' ? 'ENGR' : 'ALL')) as PulseTargetRole; if (!ROLES.has(targetRole)) { res.status(400).json({ error: 'Invalid target role.' }); return; }
  res.status(201).json(await postPulseCard({ type, arNumber, payload, postedBy: req.user!.userId, targetRole, targetUserId: Number(req.body?.targetUserId) || null }));
});

router.post('/acknowledge', async (req, res) => { const messageId = Number(req.body?.messageId); if (!Number.isSafeInteger(messageId) || messageId < 1) { res.status(400).json({ error: 'A valid messageId is required.' }); return; } const pool = getDbPool(); await pool.execute('INSERT INTO pulse_acknowledgments (message_id,user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE acknowledged_at = CURRENT_TIMESTAMP', [messageId, req.user!.userId]); await pool.execute("UPDATE pulse_messages SET status = 'ACKNOWLEDGED' WHERE id = ? AND status <> 'RESOLVED'", [messageId]); res.json({ success: true }); });

router.post('/subscribe', async (req, res) => { const endpoint = text(req.body?.endpoint); const p256dh = text(req.body?.p256dh); const auth = text(req.body?.auth); if (!endpoint || !p256dh || !auth) { res.status(400).json({ error: 'A complete push subscription is required.' }); return; } await getDbPool().execute('INSERT INTO pulse_subscriptions (user_id,endpoint,p256dh,auth,device_label) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE p256dh=VALUES(p256dh), auth=VALUES(auth), device_label=VALUES(device_label), last_used_at=CURRENT_TIMESTAMP', [req.user!.userId, endpoint, p256dh, auth, text(req.body?.deviceLabel) || null]); res.json({ success: true }); });
router.delete('/subscribe', async (req, res) => { await getDbPool().execute('DELETE FROM pulse_subscriptions WHERE user_id = ? AND endpoint = ?', [req.user!.userId, text(req.body?.endpoint)]); res.json({ success: true }); });

router.get('/vapid-public-key', (_req, res) => { res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null }); });
router.get('/ar/:arNumber', async (req, res) => { const ar = text(req.params.arNumber); const pool = getDbPool(); const [events] = await pool.query(`SELECT 'FRONTLINE' AS source, COALESCE(imported_at, occurred_date) AS timestamp, CONCAT('Frontline: ', transaction_type) AS event, cso AS actor FROM frontline_records WHERE ar_number = ? UNION ALL SELECT 'STORAGE', m.occurred_at, CONCAT('Storage ', m.action, ' cabinet ', COALESCE(m.cabinet_number, '')), e.full_name FROM storage_movements m JOIN storage_units su ON su.id = m.unit_id JOIN storage_employees e ON e.id = m.employee_id WHERE su.ar_number = ? UNION ALL SELECT 'ENDORSEMENT', e.created_at, CONCAT('Endorsed to ', e.engineer_name), u.full_name FROM engineer_endorsements e LEFT JOIN users u ON u.id = e.cso_user_id WHERE e.ar_number = ? UNION ALL SELECT 'PARTS', pm.created_at, CONCAT('Parts ', pm.type, ': ', pm.part_number), u.full_name FROM parts_movements pm LEFT JOIN users u ON u.id = pm.actor_user_id WHERE pm.reference = ? UNION ALL SELECT 'PULSE', m.created_at, m.type, u.full_name FROM pulse_messages m LEFT JOIN users u ON u.id = m.posted_by WHERE m.ar_number = ? ORDER BY timestamp ASC`, [ar, ar, ar, ar, ar]); res.json({ arNumber: ar, timeline: events }); });
router.post('/handover', async (req, res) => { const pool = getDbPool(); const [endorsements] = await pool.query("SELECT ar_number AS arNumber, engineer_name AS engineer, TIMESTAMPDIFF(HOUR, created_at, NOW()) AS waitingHours FROM engineer_endorsements WHERE engineer_user_id = ? AND status = 'endorsed'", [req.user!.userId]); const [parts] = await pool.query("SELECT reference AS arNumber, part_number AS partNumber FROM parts_movements WHERE actor_user_id = ? AND type = 'OUT'", [req.user!.userId]); const [units] = await pool.query("SELECT ar_number AS arNumber, cabinet_number AS cabinet FROM storage_units su JOIN storage_employees se ON se.id = su.current_employee_id WHERE se.id = ? AND su.state = 'in'", [req.user!.userId]); const payload = { openEndorsements: endorsements as Array<{ arNumber: string; engineer: string; waitingHours: number }>, pendingPartsRequests: parts as Array<{ arNumber: string; partNumber: string }>, unitsInCabinet: units as Array<{ arNumber: string; cabinet: string }>, totalOpen: (endorsements as unknown[]).length + (parts as unknown[]).length + (units as unknown[]).length }; res.status(201).json(await postPulseCard({ type: 'SHIFT_HANDOVER', payload, postedBy: req.user!.userId, targetRole: 'ALL' })); });

export default router;
