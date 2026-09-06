import { Router, Request, Response } from 'express';
import { getDbPool } from '../db/index.js';
import { authenticateToken } from '../auth.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureFrontlineTables } from '../frontline/store.js';
import { QueueError, availableQueues, dayBounds, ensureQueueTables, lockDay, resolveDivision, todayManila, withQueue } from './queue.js';
import { assignNext, changeDeviceModel, changeEngineer, previewAssignment, removeEndorsement, reorderQueue, skipNext } from './assignments.js';

const router = Router();
router.use(authenticateToken);
const allowedCalendarDivisions = new Set(['iOS/ACCS', 'MacBook', 'iMac']);

function text(value: unknown) { return String(value ?? '').trim(); }
function canonicalEngineerName(value: string) { const name = text(value); return name.toLowerCase() === 'k' ? 'Karl' : name; }
function isoTimestamp(value: unknown) { if (!value) return null; const date = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : date.toISOString(); }
function isEngineer(req: Request) { return req.user?.roleName === 'ENGR'; }
function canEndorse(req: Request) { return Boolean(req.user?.isSuperAdmin) || req.user?.roleName === 'Admin' || req.user?.roleName === 'CSO'; }
function canView(req: Request) { return canEndorse(req) || canManageRoster(req) || isEngineer(req); }
function canManageRoster(req: Request) { return Boolean(req.user?.isSuperAdmin) || req.user?.roleName === 'Admin' || req.user?.roleName === 'PMG' || req.user?.roleName === 'CSO'; }
function canManageAvailability(req: Request) { return canManageRoster(req) || isEngineer(req); }
function canEditCalendar(req: Request) { return canEndorse(req) || isEngineer(req); }
function canDeleteEndorsement(req: Request) { return canEndorse(req) || isEngineer(req); }
function forbidden(res: Response) { res.status(403).json({ error: 'Engineer Endorsements access required' }); }
function endorsementDivision(deviceModel: string, sourceDivision: string) { return resolveDivision(deviceModel, sourceDivision) || sourceDivision; }
function queueRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => { void handler(req, res).catch((error) => {
    if (error instanceof QueueError) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'This record was already updated. Refresh and review it again.' }); return; }
    console.error('endorsement operation failed:', error);
    res.status(500).json({ error: 'Unable to update endorsements. Please try again.' });
  }); };
}

router.post('/availability/join', queueRoute(async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  await withQueue(async (connection, date) => {
    const [users] = await connection.query('SELECT full_name FROM users WHERE id = ?', [req.user!.userId]);
    const name = canonicalEngineerName(text((users as Array<{ full_name: string }>)[0]?.full_name));
    if (!name) throw new QueueError(400, 'An Engineer name is required.');
    await connection.execute('INSERT INTO engineer_roster (user_id, engineer_name, active) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), active = 1', [req.user!.userId, name]);
    await connection.execute(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status) VALUES (?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), status = 'active', left_at = NULL`, [req.user!.userId, name, date]);
  });
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_joined', resourceType: 'engineer_daily_availability' });
  res.json({ message: 'You are available in all three queues today.' });
}));

router.post('/availability/leave', queueRoute(async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  await withQueue(async (connection, date) => {
    await connection.execute("UPDATE engineer_daily_availability SET status = 'left', left_at = CURRENT_TIMESTAMP WHERE user_id = ? AND availability_date = ?", [req.user!.userId, date]);
  });
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_left', resourceType: 'engineer_daily_availability' });
  res.json({ message: 'You are away from all three queues today.' });
}));

router.post('/availability/skip', queueRoute(async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  const result = await skipNext(req.body?.division, req.body?.reason, req.body?.queueToken, req.user!.userId, req.user!.userId);
  res.json(result);
}));

router.post('/availability/pass-next', queueRoute(async (req, res) => {
  if (!canManageAvailability(req)) { forbidden(res); return; }
  const result = await skipNext(req.body?.division, req.body?.reason, req.body?.queueToken, req.user!.userId, isEngineer(req) ? req.user!.userId : undefined);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_passed', resourceType: 'engineer_queue_events', metadata: { division: req.body.division, reason: req.body.reason, engineer: result.engineer } });
  res.json(result);
}));

const scheduleDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
router.get('/availability/schedule', async (req, res) => {
  if (!isEngineer(req) && !canManageRoster(req)) { forbidden(res); return; }
  await ensureQueueTables();
  const requestedName = text(req.query.engineerName);
  const [users] = await getDbPool().query('SELECT full_name FROM users WHERE id = ?', [req.user!.userId]);
  const engineerName = canManageRoster(req) && requestedName ? requestedName : text((users as Array<{ full_name: string }>)[0]?.full_name);
  const [rows] = await getDbPool().query('SELECT rest_days FROM engineer_roster_schedules WHERE engineer_name = ?', [engineerName]);
  const value = String((rows as Array<{ rest_days?: string }>)[0]?.rest_days || '');
  res.json({ restDays: value.split(',').filter((day) => scheduleDays.includes(day)) });
});
router.put('/availability/schedule', queueRoute(async (req, res) => {
  if (!isEngineer(req) && !canManageRoster(req)) { forbidden(res); return; }
  const restDays = Array.isArray(req.body?.restDays) ? req.body.restDays.filter((day: unknown): day is string => typeof day === 'string' && scheduleDays.includes(day)) : [];
  if (new Set(restDays).size !== restDays.length) throw new QueueError(400, 'Choose each rest day once.');
  const requestedName = text(req.body?.engineerName);
  const [users] = await getDbPool().query('SELECT full_name FROM users WHERE id = ?', [req.user!.userId]);
  const engineerName = canManageRoster(req) && requestedName ? requestedName : text((users as Array<{ full_name: string }>)[0]?.full_name);
  if (!engineerName) throw new QueueError(400, 'Choose an Engineer.');
  await withQueue(async (connection, date) => {
    await connection.execute('INSERT INTO engineer_roster_schedules (engineer_name, rest_days) VALUES (?, ?) ON DUPLICATE KEY UPDATE rest_days = VALUES(rest_days)', [engineerName, restDays.join(',')]);
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Manila' }).format(new Date(`${date}T00:00:00+08:00`));
    const isRestDay = restDays.includes(weekday);
    await connection.execute('UPDATE engineer_daily_availability SET status = ?, left_at = CURRENT_TIMESTAMP WHERE engineer_name = ? AND availability_date = ?', [isRestDay ? 'left' : 'active', engineerName, date]);
    if (!isRestDay) await connection.execute('UPDATE engineer_daily_availability SET left_at = NULL WHERE engineer_name = ? AND availability_date = ?', [engineerName, date]);
  });
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_schedule_updated', resourceType: 'engineer_availability_schedule', metadata: { engineerName, restDays } });
  res.json({ message: 'Weekly availability schedule saved.', restDays });
}));

router.put('/availability/order', queueRoute(async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  const result = await reorderQueue(req.body?.division, req.body?.engineerIds, req.body?.queueToken, req.user!.userId);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.queue_reordered', resourceType: 'engineer_queue_events', metadata: { division: req.body?.division, engineerIds: req.body?.engineerIds } });
  res.json(result);
}));

router.post('/availability/add', queueRoute(async (req, res) => {
  if (!canManageAvailability(req)) { forbidden(res); return; }
  const name = canonicalEngineerName(text(req.body?.name));
  if (!name || name.length > 150) throw new QueueError(400, 'Engineer name is required.');
  await withQueue(async (connection, date) => {
    const [roster] = await connection.query('SELECT id, user_id FROM engineer_roster WHERE engineer_name = ? AND active = 1', [name]);
    const userId = (roster as Array<{ user_id: number | null }>)[0]?.user_id ?? null;
    if (isEngineer(req) && userId !== req.user!.userId) throw new QueueError(403, 'Engineers can only change their own availability.');
    await connection.execute('INSERT INTO engineer_roster (user_id, engineer_name, active) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE active = 1', [userId, name]);
    await connection.execute(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status) VALUES (?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE status = 'active', left_at = NULL`, [userId, name, date]);
  });
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_added', resourceType: 'engineer_daily_availability', metadata: { name } });
  res.json({ message: `${name} is available in all three queues.` });
}));

router.post('/availability/remove', queueRoute(async (req, res) => {
  if (!canManageAvailability(req)) { forbidden(res); return; }
  const id = Number(req.body?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new QueueError(400, 'Choose an Engineer.');
  await withQueue(async (connection, date) => {
    if (isEngineer(req)) {
      const [rows] = await connection.query('SELECT user_id FROM engineer_daily_availability WHERE id = ? AND availability_date = ? FOR UPDATE', [id, date]);
      if (Number((rows as Array<{ user_id: number | null }>)[0]?.user_id) !== req.user!.userId) throw new QueueError(403, 'Engineers can only change their own availability.');
    }
    const [result] = await connection.execute("UPDATE engineer_daily_availability SET status = 'left', left_at = CURRENT_TIMESTAMP WHERE id = ? AND availability_date = ?", [id, date]);
    if (!Number((result as { affectedRows: number }).affectedRows)) throw new QueueError(409, "Refresh today's availability list.");
  });
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_removed', resourceType: 'engineer_daily_availability', resourceId: String(id) });
  res.json({ message: 'Engineer marked Away in all three queues.' });
}));

router.get('/roster', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query(`SELECT r.id, COALESCE(r.user_id, u.id) AS user_id, r.engineer_name AS full_name, r.active, r.created_at, r.updated_at
    FROM engineer_roster r LEFT JOIN users u ON LOWER(TRIM(u.full_name)) = LOWER(TRIM(r.engineer_name))
    WHERE r.active = 1 ORDER BY r.engineer_name ASC, r.id ASC`);
  res.json({ roster: rows });
});

router.post('/roster', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  const name = canonicalEngineerName(text(req.body?.name));
  if (!name || name.length > 150) { res.status(400).json({ error: 'A valid Engineer name is required.' }); return; }
  await ensureFrontlineTables();
  try {
    const [result] = await getDbPool().execute('INSERT INTO engineer_roster (user_id, engineer_name, active) VALUES (NULL, ?, 1)', [name]);
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_created', resourceType: 'engineer_roster', resourceId: String((result as { insertId?: number }).insertId), metadata: { name } });
    res.status(201).json({ message: `${name} added to the Engineer roster.`, name });
  } catch (error) { if (String((error as Error).message).includes('Duplicate')) { res.status(409).json({ error: 'An Engineer with that name already exists.' }); return; } console.error('create engineer roster error:', error); res.status(500).json({ error: 'Unable to add the Engineer.' }); }
});

router.patch('/roster/:id', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  const id = Number(req.params.id); const name = canonicalEngineerName(text(req.body?.name));
  if (!id || !name || name.length > 150) { res.status(400).json({ error: 'A valid Engineer name is required.' }); return; }
  await ensureQueueTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockDay(connection, todayManila());
    const [rows] = await connection.query('SELECT id, engineer_name, user_id FROM engineer_roster WHERE id = ? AND active = 1 FOR UPDATE', [id]);
    const current = (rows as Array<{ id: number; engineer_name: string; user_id: number | null }>)[0];
    if (!current) { await connection.rollback(); res.status(404).json({ error: 'Engineer roster entry not found.' }); return; }
    await connection.execute('UPDATE engineer_roster SET engineer_name = ? WHERE id = ?', [name, id]);
    await connection.execute('UPDATE engineer_daily_availability SET engineer_name = ? WHERE engineer_name = ? AND user_id <=> ?', [name, current.engineer_name, current.user_id]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_name_updated', resourceType: 'engineer_roster', resourceId: String(id), metadata: { fromName: current.engineer_name, toName: name } });
    res.json({ message: `${name} updated.`, name });
  } catch (error) { await connection.rollback(); if (String((error as Error).message).includes('Duplicate')) { res.status(409).json({ error: 'An Engineer with that name already exists.' }); return; } console.error('update engineer roster error:', error); res.status(500).json({ error: 'Unable to update the Engineer name.' }); } finally { connection.release(); }
});

router.delete('/roster/:id', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  const id = Number(req.params.id); if (!id) { res.status(400).json({ error: 'A valid Engineer is required.' }); return; }
  await ensureQueueTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockDay(connection, todayManila());
    const [rows] = await connection.query('SELECT id, engineer_name, user_id FROM engineer_roster WHERE id = ? AND active = 1 FOR UPDATE', [id]);
    const engineer = (rows as Array<Record<string, unknown>>)[0];
    if (!engineer) { await connection.rollback(); res.status(404).json({ error: 'Engineer roster entry not found.' }); return; }
    await connection.execute('UPDATE engineer_roster SET active = 0 WHERE id = ?', [id]);
    await connection.execute('UPDATE engineer_daily_availability SET status = \'left\', left_at = CURRENT_TIMESTAMP WHERE availability_date = ? AND engineer_name = ? AND user_id <=> ?', [todayManila(), text(engineer.engineer_name), engineer.user_id == null ? null : Number(engineer.user_id)]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_deactivated', resourceType: 'engineer_roster', resourceId: String(id), metadata: { name: text(engineer.engineer_name) } });
    res.json({ message: `${text(engineer.engineer_name)} removed from the Engineer roster.` });
  } catch (error) { await connection.rollback(); console.error('delete engineer roster error:', error); res.status(500).json({ error: 'Unable to remove the Engineer.' }); } finally { connection.release(); }
});

router.get('/available', queueRoute(async (req, res) => {
  if (!canView(req)) { forbidden(res); return; }
  const result = await availableQueues();
  const selected = result.queues.find((queue) => queue.division === req.query.division);
  res.set('Cache-Control', 'no-store').json({ ...result, engineers: selected?.engineers || [], nextEngineer: selected?.nextEngineer || null });
}));

router.post('/preview', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  res.set('Cache-Control', 'no-store').json(await previewAssignment(req.body || {}));
}));

router.get('/notifications', async (req, res) => {
  if (!canView(req)) { forbidden(res); return; }
  const afterId = Math.max(0, Number(req.query.afterId) || 0);
  await ensureFrontlineTables();
  const engineerFilter = isEngineer(req)
    ? ' AND (e.engineer_user_id = ? OR (e.engineer_user_id IS NULL AND e.engineer_name = (SELECT engineer_name FROM engineer_roster WHERE user_id = ? ORDER BY id DESC LIMIT 1)))'
    : '';
  const engineerArgs = isEngineer(req) ? [req.user!.userId, req.user!.userId] : [];
  const [rows] = await getDbPool().query(`SELECT e.id, e.ar_number, e.device_model, e.issue, e.engineer_name, e.cso_user_id, e.created_at FROM engineer_endorsements e WHERE e.id > ?${engineerFilter} ORDER BY e.id ASC LIMIT 25`, [afterId, ...engineerArgs]);
  res.json((rows as Array<Record<string, unknown>>).map((row) => ({ ...row, created_at: isoTimestamp(row.created_at) })));
});

router.get('/calendar', async (req, res) => {
  if (!canView(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const requestedMonth = text(req.query.month);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : todayManila().slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const pool = getDbPool();

  const [detailRows] = await pool.query(`SELECT id, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+08:00'), '%Y-%m-%d') AS endorsement_date, ar_number, device_model, issue, product_division, status, engineer_name, created_at FROM engineer_endorsements WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`, [dayBounds(`${month}-01`)[0], dayBounds(nextMonth)[0]]);
  const [manualRows] = await pool.query(`SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS endorsement_date, entry_count AS manual_count, details, product_division, engineer_name, created_at FROM engineer_calendar_entries WHERE entry_date >= ? AND entry_date < ?`, [`${month}-01`, nextMonth]);
  const preferredDivisions = ['iOS/ACCS', 'MacBook', 'iMac']; const allowedDivisions = new Set(preferredDivisions); const canonicalDivision = (value: string) => { const normalized = value.trim().toLowerCase(); if (normalized.includes('accs') || ['iphone', 'ipad', 'watch', 'ipod', 'ios/accs'].includes(normalized)) return 'iOS/ACCS'; if (normalized === 'macbook') return 'MacBook'; if (normalized === 'imac') return 'iMac'; return value; }; const divisions = preferredDivisions;
  const [rosterRows] = await pool.query(`SELECT DISTINCT NULLIF(TRIM(engineer_name), '') AS engineer_name FROM engineer_roster WHERE active = 1`);
  const knownEngineers = new Set<string>((rosterRows as Array<{ engineer_name: string | null }>).map((row) => row.engineer_name || '').filter(Boolean));
  const counts = new Map<string, Record<string, Record<string, Array<Record<string, unknown>>>>>(); const totals: Record<string, number> = {}; const engineerTotals: Record<string, number> = {}; const monthlyEngineerTotals: Record<string, Record<string, number>> = {}; const divisionEngineers = new Map<string, Set<string>>(divisions.map((division) => [division, new Set(knownEngineers)]));
  const details = new Map<string, Array<Record<string, unknown>>>();
  for (const row of detailRows as Array<Record<string, unknown>>) { const date = String(row.endorsement_date).slice(0, 10); const sourceDivision = canonicalDivision(text(row.product_division) || 'Unspecified'); const division = endorsementDivision(text(row.device_model), sourceDivision); if (!allowedDivisions.has(division)) continue; const engineer = text(row.engineer_name) || 'Unassigned'; const day = counts.get(date) || {}; day[division] = day[division] || {}; day[division][engineer] = [...(day[division][engineer] || []), { ...row, product_division: division }]; counts.set(date, day); totals[division] = (totals[division] || 0) + 1; engineerTotals[`${division}::${engineer}`] = (engineerTotals[`${division}::${engineer}`] || 0) + 1; monthlyEngineerTotals[division] = monthlyEngineerTotals[division] || {}; monthlyEngineerTotals[division][engineer] = (monthlyEngineerTotals[division][engineer] || 0) + 1; const names = divisionEngineers.get(division) || new Set<string>(); names.add(engineer); divisionEngineers.set(division, names); details.set(date, [...(details.get(date) || []), { ...row, product_division: division }]); }
  for (const row of manualRows as Array<Record<string, unknown>>) { const date = String(row.endorsement_date).slice(0, 10); const division = canonicalDivision(text(row.product_division) || 'Unspecified'); if (!allowedDivisions.has(division)) continue; const engineer = canonicalEngineerName(text(row.engineer_name) || 'Unassigned'); const entry = { ...row, product_division: division, engineer_name: engineer, is_manual: true }; const day = counts.get(date) || {}; day[division] = day[division] || {}; day[division][engineer] = [...(day[division][engineer] || []), entry]; counts.set(date, day); const count = Number(row.manual_count) || 0; totals[division] = (totals[division] || 0) + count; engineerTotals[`${division}::${engineer}`] = (engineerTotals[`${division}::${engineer}`] || 0) + count; const names = divisionEngineers.get(division) || new Set<string>(); names.add(engineer); divisionEngineers.set(division, names); }
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => { const day = String(index + 1).padStart(2, '0'); const date = `${month}-${day}`; return { date, day: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)), counts: counts.get(date) || {}, endorsements: details.get(date) || [] }; });
  const [savedOrderRows] = await pool.query('SELECT product_division, engineer_name, sort_order FROM engineer_calendar_orders WHERE order_month = ? ORDER BY product_division ASC, sort_order ASC, engineer_name ASC', [month]);
  const engineerOrder: Record<string, string[]> = {};
  const columns = divisions.flatMap((division) => { const knownEngineerList = Array.from(divisionEngineers.get(division) || []); const savedOrder = (savedOrderRows as Array<{ product_division: string; engineer_name: string }>).filter((row) => row.product_division === division).map((row) => row.engineer_name).filter((name) => knownEngineerList.includes(name)); const defaultOrder = [...knownEngineerList].sort((a, b) => a.localeCompare(b)); const order = [...savedOrder, ...defaultOrder.filter((name) => !savedOrder.includes(name))]; engineerOrder[division] = order; const orderIndex = new Map(order.map((name, index) => [name, index])); return order.map((engineer) => ({ division, engineer, total: engineerTotals[`${division}::${engineer}`] || 0 })).sort((a, b) => (orderIndex.get(a.engineer) ?? 0) - (orderIndex.get(b.engineer) ?? 0)); });
  res.json({ month, divisions, engineerOrder, columns, totals, days });
});

router.put('/calendar-order', async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const month = text(req.body?.month); const division = text(req.body?.division); const rawNames: unknown = req.body?.engineerOrder; const names: string[] = Array.isArray(rawNames) ? rawNames.map((name: unknown) => canonicalEngineerName(text(name))).filter((name): name is string => Boolean(name)) : [];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !allowedCalendarDivisions.has(division) || !names.length || new Set(names).size !== names.length) { res.status(400).json({ error: 'A valid month, category, and unique Engineer order are required.' }); return; }
  const [year, monthNumber] = month.split('-').map(Number); const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1)); const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  await ensureFrontlineTables(); const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [validRows] = await connection.query(`SELECT engineer_name FROM engineer_roster WHERE active = 1 AND engineer_name IN (${names.map(() => '?').join(',')}) UNION SELECT engineer_name FROM engineer_endorsements WHERE created_at >= ? AND created_at < ? AND engineer_name IN (${names.map(() => '?').join(',')})`, [ ...names, `${month}-01`, nextMonth, ...names ]);
    const validNames = new Set((validRows as Array<{ engineer_name: string }>).map((row) => row.engineer_name));
    if (names.some((name: string) => !validNames.has(name))) { await connection.rollback(); res.status(400).json({ error: 'Engineer order contains an unknown or inactive Engineer.' }); return; }
    await connection.execute('DELETE FROM engineer_calendar_orders WHERE order_month = ? AND product_division = ?', [month, division]);
    await connection.query(`INSERT INTO engineer_calendar_orders (order_month, product_division, engineer_name, sort_order, created_by) VALUES ${names.map(() => '(?, ?, ?, ?, ?)').join(',')}`, names.flatMap((name: string, index: number) => [month, division, name, index, req.user!.userId]));
    await connection.commit(); res.json({ message: 'Calendar Engineer order saved.' });
  } catch (error) { await connection.rollback(); console.error('calendar order error:', error); res.status(500).json({ error: 'Unable to save the calendar Engineer order.' }); } finally { connection.release(); }
});

router.post('/', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const result = await assignNext(req.body || {}, req.user!.userId);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsed', resourceType: 'engineer_endorsement', resourceId: result.endorsementId, metadata: { engineer: result.engineer.name, division: result.record.productDivision } });
  res.status(201).json(result);
}));

router.put('/calendar-entry', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const date = text(req.body?.date); const division = text(req.body?.division); const engineer = canonicalEngineerName(text(req.body?.engineer));
  const count = Number(req.body?.count); const details = text(req.body?.details);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowedCalendarDivisions.has(division) || !engineer || engineer.length > 150 || !Number.isInteger(count) || count < 1 || count > 999) throw new QueueError(400, 'A valid date, division, Engineer, and whole-number count are required.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new QueueError(400, 'Enter a valid calendar date.');
  const arNumbers = Array.isArray(req.body?.arNumbers) ? req.body.arNumbers.map(text).filter(Boolean) : [];
  if (arNumbers.length) {
    if (arNumbers.length !== 1 || date !== todayManila()) throw new QueueError(400, 'Review one AR for today using Assign next.');
    const result = await assignNext({ arNumber: arNumbers[0], division, queueToken: req.body?.queueToken }, req.user!.userId, engineer);
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsed', resourceType: 'engineer_endorsement', resourceId: result.endorsementId, metadata: { engineer, division } });
    res.json(result); return;
  }
  await ensureFrontlineTables();
  const [roster] = await getDbPool().query('SELECT id FROM engineer_roster WHERE engineer_name = ?', [engineer]);
  if (!(roster as unknown[]).length) throw new QueueError(400, 'Choose an active Engineer from the roster.');
  await getDbPool().execute(`INSERT INTO engineer_calendar_entries (entry_date, product_division, engineer_name, entry_count, details, created_by)
    VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE entry_count=VALUES(entry_count), details=VALUES(details), created_by=VALUES(created_by)`, [date, division, engineer, count, details.slice(0, 1000), req.user!.userId]);
  res.json({ message: 'Manual count saved. Round-robin turns are unchanged.' });
}));

router.delete('/calendar-entry', async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const date = text(req.body?.date); const division = text(req.body?.division); const engineer = canonicalEngineerName(text(req.body?.engineer));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowedCalendarDivisions.has(division) || !engineer) { res.status(400).json({ error: 'Date, category, and Engineer are required.' }); return; }
  await ensureFrontlineTables();
  const [result] = await getDbPool().execute('DELETE FROM engineer_calendar_entries WHERE entry_date = ? AND product_division = ? AND engineer_name = ?', [date, division, engineer]);
  if (!Number((result as { affectedRows?: number }).affectedRows)) { res.status(404).json({ error: 'Manual calendar entry not found.' }); return; }
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.calendar_entry_deleted', resourceType: 'engineer_calendar_entry', resourceId: `${date}:${division}:${engineer}`, metadata: { date, division, engineer } });
  res.json({ message: 'Manual calendar entry deleted.' });
});

router.post('/:id/pass', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const result = await changeEngineer(Number(req.params.id), null, req.user!.userId);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_passed', resourceType: 'engineer_endorsement', resourceId: req.params.id, metadata: result });
  res.json(result);
}));

router.patch('/:id/engineer', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const name = canonicalEngineerName(text(req.body?.engineerName));
  if (!name || name.length > 150) throw new QueueError(400, 'Choose an Engineer.');
  const result = await changeEngineer(Number(req.params.id), name, req.user!.userId);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_engineer_updated', resourceType: 'engineer_endorsement', resourceId: req.params.id, metadata: result });
  res.json(result);
}));

router.post('/:id/cancel', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const result = await removeEndorsement(Number(req.params.id), true);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_cancelled', resourceType: 'engineer_endorsement', resourceId: req.params.id, metadata: result });
  res.json(result);
}));

router.delete('/:id', queueRoute(async (req, res) => {
  if (!canDeleteEndorsement(req)) { forbidden(res); return; }
  const result = await removeEndorsement(Number(req.params.id));
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_deleted', resourceType: 'engineer_endorsement', resourceId: req.params.id, metadata: result });
  res.json(result);
}));

router.patch('/:id', queueRoute(async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const result = await changeDeviceModel(Number(req.params.id), text(req.body?.deviceModel), req.user!.userId);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_device_model_updated', resourceType: 'engineer_endorsement', resourceId: req.params.id, metadata: result });
  res.json(result);
}));

router.get('/dashboard', async (req, res) => {
  if (!canView(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const engineerId = isEngineer(req) ? req.user!.userId : Number(req.query.engineerUserId) || null;
  const [availabilityRows] = await pool.query(`SELECT user_id, status, joined_at, left_at, assignment_count FROM engineer_daily_availability WHERE availability_date = ? ${engineerId ? 'AND user_id = ?' : ''}`, engineerId ? [todayManila(), engineerId] : [todayManila()]);
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total, SUM(status = 'endorsed') AS pending FROM engineer_endorsements ${engineerId ? 'WHERE engineer_user_id = ?' : ''}`, engineerId ? [engineerId] : []);
  const [divisionRows] = await pool.query(`SELECT product_division, COUNT(*) AS total FROM engineer_endorsements ${engineerId ? 'WHERE engineer_user_id = ?' : ''} GROUP BY product_division ORDER BY total DESC`, engineerId ? [engineerId] : []);
  const [endorsementRows] = await pool.query(`SELECT e.id, e.ar_number, e.device_model, e.issue, e.product_division, e.status, e.created_at, e.engineer_name, cso.full_name AS cso_name FROM engineer_endorsements e LEFT JOIN users cso ON cso.id = e.cso_user_id ${engineerId ? 'WHERE e.engineer_user_id = ? OR (e.engineer_user_id IS NULL AND e.engineer_name = (SELECT engineer_name FROM engineer_daily_availability WHERE user_id = ? ORDER BY id DESC LIMIT 1))' : ''} ORDER BY e.created_at DESC LIMIT 100`, engineerId ? [engineerId, engineerId] : []);
  res.json({ date: todayManila(), availability: (availabilityRows as Array<Record<string, unknown>>)[0] || null, totals: (countRows as Array<Record<string, unknown>>)[0] || { total: 0, pending: 0 }, divisions: divisionRows, endorsements: endorsementRows });
});

export default router;
