import { Router, Request, Response } from 'express';
import { getDbPool } from '../db/index.js';
import { authenticateToken } from '../auth.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureFrontlineTables } from '../frontline/store.js';

const router = Router();
router.use(authenticateToken);
const allowedCalendarDivisions = new Set(['iOS/ACCS', 'MacBook', 'iMac']);

function text(value: unknown) { return String(value ?? '').trim(); }
function canonicalEngineerName(value: string) { const name = text(value); return name.toLowerCase() === 'k' ? 'Karl' : name; }
function todayManila() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); }
function isoTimestamp(value: unknown) { if (!value) return null; const date = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : date.toISOString(); }
function isEngineer(req: Request) { return req.user?.roleName === 'ENGR'; }
function canEndorse(req: Request) { return req.user?.roleName === 'Admin' || req.user?.roleName === 'CSO'; }
function canView(req: Request) { return canEndorse(req) || canManageRoster(req) || isEngineer(req); }
function canManageRoster(req: Request) { return req.user?.roleName === 'Admin' || req.user?.roleName === 'PMG' || req.user?.roleName === 'CSO'; }
function canManageAvailability(req: Request) { return canManageRoster(req) || isEngineer(req); }
function canEditCalendar(req: Request) { return req.user?.roleName === 'Admin' || isEngineer(req); }
function canDeleteEndorsement(req: Request) { return canEndorse(req) || isEngineer(req); }
function forbidden(res: Response) { res.status(403).json({ error: 'Engineer Endorsements access required' }); }
function endorsementDivision(deviceModel: string, sourceDivision: string) {
  if (/^MacBook\b/i.test(deviceModel)) return 'MacBook';
  if (/^iMac\b/i.test(deviceModel)) return 'iMac';
  if (/^(iPhone|iPad|Apple Watch)\b/i.test(deviceModel)) return 'iOS/ACCS';
  return sourceDivision;
}

router.post('/availability/join', async (req, res) => {
  if (!isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  const [userRows] = await pool.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user!.userId]);
  const engineerName = text((userRows as Array<{ full_name: string }>)[0]?.full_name || req.user!.email);
  await pool.execute(`INSERT INTO engineer_roster (user_id, engineer_name, active) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), active = 1`, [req.user!.userId, engineerName]);
  const [existing] = await pool.query('SELECT id FROM engineer_daily_availability WHERE (user_id = ? OR engineer_name = ?) AND availability_date = ? LIMIT 1', [req.user!.userId, engineerName, todayManila()]);
  if ((existing as Array<Record<string, unknown>>).length) await pool.execute("UPDATE engineer_daily_availability SET user_id = ?, engineer_name = ?, status = 'active', left_at = NULL WHERE id = ?", [req.user!.userId, engineerName, Number((existing as Array<Record<string, unknown>>)[0].id)]);
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

router.post('/availability/pass-next', async (req, res) => {
  if (!canEndorse(req) && !canManageRoster(req) && !isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT id, engineer_name FROM engineer_daily_availability WHERE availability_date = ? AND status = 'active' ORDER BY last_assigned_at IS NOT NULL ASC, last_assigned_at ASC, assignment_count ASC, joined_at ASC, id ASC LIMIT 1 FOR UPDATE`, [todayManila()]);
    const next = (rows as Array<{ id: number; engineer_name: string }>)[0];
    if (!next) { await connection.rollback(); res.status(409).json({ error: 'No Engineer is currently available.' }); return; }
    await connection.execute('UPDATE engineer_daily_availability SET last_assigned_at = CURRENT_TIMESTAMP WHERE id = ?', [next.id]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.availability_passed', resourceType: 'engineer_daily_availability', resourceId: String(next.id), metadata: { engineerName: next.engineer_name, date: todayManila() } });
    res.json({ message: `${next.engineer_name} was passed. The next available Engineer is now up.` });
  } catch (error) { await connection.rollback(); console.error('pass-next error:', error); res.status(500).json({ error: 'Unable to pass to the next Engineer.' }); } finally { connection.release(); }
});

router.post('/availability/add', async (req, res) => {
  if (!canManageAvailability(req)) { forbidden(res); return; }
  const name = canonicalEngineerName(text(req.body?.name)); if (!name || name.length > 150) { res.status(400).json({ error: 'Engineer name is required.' }); return; }
  await ensureFrontlineTables(); const pool = getDbPool();
  if (isEngineer(req)) {
    const [existingRoster] = await pool.query('SELECT id FROM engineer_roster WHERE engineer_name = ? AND active = 1 LIMIT 1', [name]);
    if (!(existingRoster as Array<Record<string, unknown>>).length) { forbidden(res); return; }
  }
  await pool.execute(`INSERT INTO engineer_roster (user_id, engineer_name, active) VALUES (NULL, ?, 1) ON DUPLICATE KEY UPDATE active = 1`, [name]);
  await pool.execute(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status) VALUES (NULL, ?, ?, 'active') ON DUPLICATE KEY UPDATE status = 'active', left_at = NULL`, [name, todayManila()]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_added', resourceType: 'engineer_daily_availability', metadata: { name, date: todayManila() } });
  res.json({ message: `${name} is available for endorsements today.` });
});

router.post('/availability/remove', async (req, res) => {
  if (!canManageAvailability(req)) { forbidden(res); return; }
  const id = Number(req.body?.id); if (!id) { res.status(400).json({ error: 'Engineer card is required.' }); return; }
  await ensureFrontlineTables(); const pool = getDbPool(); await pool.execute("UPDATE engineer_daily_availability SET status = 'left', left_at = CURRENT_TIMESTAMP WHERE id = ? AND availability_date = ?", [id, todayManila()]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.roster_removed', resourceType: 'engineer_daily_availability', resourceId: String(id), metadata: { date: todayManila() } });
  res.json({ message: 'Engineer removed from today’s queue.' });
});

router.get('/roster', async (req, res) => {
  if (!canManageRoster(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query('SELECT id, user_id, engineer_name AS full_name, active, created_at, updated_at FROM engineer_roster WHERE active = 1 ORDER BY engineer_name ASC, id ASC');
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
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
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
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
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

router.get('/available', async (req, res) => {
  if (!canEndorse(req) && !canManageRoster(req) && !isEngineer(req)) { forbidden(res); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  await pool.query(`INSERT INTO engineer_daily_availability (user_id, engineer_name, availability_date, status)
    SELECT r.user_id, r.engineer_name, ?, 'active' FROM engineer_roster r WHERE r.active = 1
    ON DUPLICATE KEY UPDATE engineer_name = VALUES(engineer_name), user_id = COALESCE(engineer_daily_availability.user_id, VALUES(user_id))`, [todayManila()]);
  const [rows] = await pool.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.status, a.assignment_count, a.joined_at, a.last_assigned_at
    FROM engineer_daily_availability a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.availability_date = ? AND EXISTS (SELECT 1 FROM engineer_roster r WHERE r.active = 1 AND (r.engineer_name = a.engineer_name OR (r.user_id IS NOT NULL AND r.user_id = a.user_id)))
    ORDER BY a.status = 'active' DESC, a.last_assigned_at IS NOT NULL ASC, a.last_assigned_at ASC, a.assignment_count ASC, a.joined_at ASC, a.id ASC`, [todayManila()]);
  const roster = rows as Array<Record<string, unknown>>;
  const engineers = roster.filter((engineer) => engineer.status === 'active');
  res.json({ date: todayManila(), engineers, roster, nextEngineer: engineers[0] || null });
});

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
  const [divisionRows] = await pool.query('SELECT DISTINCT NULLIF(TRIM(product_division), \'\') AS product_division FROM engineer_endorsements WHERE created_at >= ? AND created_at < ?', [`${month}-01`, nextMonth]);
  const [detailRows] = await pool.query(`SELECT id, DATE_FORMAT(created_at, '%Y-%m-%d') AS endorsement_date, ar_number, device_model, issue, product_division, status, engineer_name, created_at FROM engineer_endorsements WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`, [`${month}-01`, nextMonth]);
  const [manualRows] = await pool.query(`SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS endorsement_date, entry_count AS manual_count, details, product_division, engineer_name, created_at FROM engineer_calendar_entries WHERE entry_date >= ? AND entry_date < ?`, [`${month}-01`, nextMonth]);
  const preferredDivisions = ['iOS/ACCS', 'MacBook', 'iMac']; const allowedDivisions = new Set(preferredDivisions); const canonicalDivision = (value: string) => { const normalized = value.trim().toLowerCase(); if (normalized.includes('accs') || ['iphone', 'ipad', 'watch', 'ipod', 'ios/accs'].includes(normalized)) return 'iOS/ACCS'; if (normalized === 'macbook') return 'MacBook'; if (normalized === 'imac') return 'iMac'; return value; }; const divisions = preferredDivisions;
  const [rosterRows] = await pool.query(`SELECT DISTINCT NULLIF(TRIM(engineer_name), '') AS engineer_name FROM engineer_roster WHERE active = 1`);
  const knownEngineers = new Set<string>((rosterRows as Array<{ engineer_name: string | null }>).map((row) => row.engineer_name || '').filter(Boolean));
  const counts = new Map<string, Record<string, Record<string, Array<Record<string, unknown>>>>>(); const totals: Record<string, number> = {}; const engineerTotals: Record<string, number> = {}; const monthlyEngineerTotals: Record<string, Record<string, number>> = {}; const divisionEngineers = new Map<string, Set<string>>(divisions.map((division) => [division, new Set(knownEngineers)]));
  const details = new Map<string, Array<Record<string, unknown>>>();
  for (const row of detailRows as Array<Record<string, unknown>>) { const date = String(row.endorsement_date).slice(0, 10); const sourceDivision = canonicalDivision(text(row.product_division) || 'Unspecified'); const division = sourceDivision === 'iOS/ACCS' && /accs/i.test(text(row.product_division)) ? 'iOS/ACCS' : endorsementDivision(text(row.device_model), sourceDivision); if (!allowedDivisions.has(division)) continue; const engineer = text(row.engineer_name) || 'Unassigned'; const day = counts.get(date) || {}; day[division] = day[division] || {}; day[division][engineer] = [...(day[division][engineer] || []), { ...row, product_division: division }]; counts.set(date, day); totals[division] = (totals[division] || 0) + 1; engineerTotals[`${division}::${engineer}`] = (engineerTotals[`${division}::${engineer}`] || 0) + 1; monthlyEngineerTotals[division] = monthlyEngineerTotals[division] || {}; monthlyEngineerTotals[division][engineer] = (monthlyEngineerTotals[division][engineer] || 0) + 1; const names = divisionEngineers.get(division) || new Set<string>(); names.add(engineer); divisionEngineers.set(division, names); details.set(date, [...(details.get(date) || []), { ...row, product_division: division }]); }
  for (const row of manualRows as Array<Record<string, unknown>>) { const date = String(row.endorsement_date).slice(0, 10); const division = canonicalDivision(text(row.product_division) || 'Unspecified'); if (!allowedDivisions.has(division)) continue; const engineer = canonicalEngineerName(text(row.engineer_name) || 'Unassigned'); const entry = { ...row, product_division: division, engineer_name: engineer, is_manual: true }; const day = counts.get(date) || {}; day[division] = day[division] || {}; day[division][engineer] = [...(day[division][engineer] || []), entry]; counts.set(date, day); const count = Number(row.manual_count) || 0; totals[division] = (totals[division] || 0) + count; engineerTotals[`${division}::${engineer}`] = (engineerTotals[`${division}::${engineer}`] || 0) + count; const names = divisionEngineers.get(division) || new Set<string>(); names.add(engineer); divisionEngineers.set(division, names); }
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => { const day = String(index + 1).padStart(2, '0'); const date = `${month}-${day}`; return { date, day: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)), counts: counts.get(date) || {}, endorsements: details.get(date) || [] }; });
  const [savedOrderRows] = await pool.query('SELECT product_division, engineer_name, sort_order FROM engineer_calendar_orders WHERE order_month = ? ORDER BY product_division ASC, sort_order ASC, engineer_name ASC', [month]);
  const engineerOrder: Record<string, string[]> = {};
  const columns = divisions.flatMap((division) => { const knownEngineerList = Array.from(divisionEngineers.get(division) || []); const savedOrder = (savedOrderRows as Array<{ product_division: string; engineer_name: string }>).filter((row) => row.product_division === division).map((row) => row.engineer_name).filter((name) => knownEngineerList.includes(name)); const defaultOrder = [...knownEngineerList].sort((a, b) => (monthlyEngineerTotals[division]?.[a] || 0) - (monthlyEngineerTotals[division]?.[b] || 0) || a.localeCompare(b)); const order = [...savedOrder, ...defaultOrder.filter((name) => !savedOrder.includes(name))]; engineerOrder[division] = order; const orderIndex = new Map(order.map((name, index) => [name, index])); return order.map((engineer) => ({ division, engineer, total: engineerTotals[`${division}::${engineer}`] || 0 })).sort((a, b) => (orderIndex.get(a.engineer) ?? 0) - (orderIndex.get(b.engineer) ?? 0)); });
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

router.post('/', async (req, res) => {
  if (!canEndorse(req)) { forbidden(res); return; }
  const arNumber = text(req.body?.arNumber); const deviceModelOverride = text(req.body?.deviceModel); const recordId = Number(req.body?.frontlineRecordId) || null; const sourceSheet = text(req.body?.sourceSheet); const sourceRow = Number(req.body?.sourceRow) || null; const serialNumber = text(req.body?.serialNumber);
  if (!arNumber || arNumber.toUpperCase() === 'N/A') { res.status(400).json({ error: 'Enter the actual AR number before endorsing this record.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const recordLookup = recordId
      ? { clause: 'id = ? OR (source_sheet = ? AND source_row = ?) OR (serial_number = ? AND serial_number <> \'\')', args: [recordId, sourceSheet, sourceRow, serialNumber] }
      : { clause: 'ar_number = ?', args: [arNumber] };
    const [recordRows] = await connection.query(`SELECT id, ar_number, device_model, serial_number, issue, product_division FROM frontline_records WHERE ${recordLookup.clause} ORDER BY id = ? DESC, id DESC LIMIT 1`, [...recordLookup.args, recordId || 0]);
    const record = (recordRows as Array<Record<string, unknown>>)[0];
    if (!record) { await connection.rollback(); res.status(404).json({ error: 'Frontline record not found for this AR number.' }); return; }
    const duplicateClause = recordId || arNumber.toUpperCase() === 'N/A' ? '(e.frontline_record_id = ? OR e.ar_number = ?)' : 'e.ar_number = ?';
    const duplicateArgs = recordId || arNumber.toUpperCase() === 'N/A' ? [Number(record.id), arNumber] : [arNumber];
    const [existingRows] = await connection.query(`SELECT e.id, e.ar_number, e.status, COALESCE(u.full_name, e.engineer_name) AS engineer_name FROM engineer_endorsements e LEFT JOIN users u ON u.id = e.engineer_user_id WHERE ${duplicateClause} FOR UPDATE`, duplicateArgs);
    if ((existingRows as Array<Record<string, unknown>>).length) { await connection.rollback(); res.status(409).json({ error: `AR ${arNumber} has already been endorsed to ${(existingRows as Array<Record<string, unknown>>)[0].engineer_name}.` }); return; }
    const [engineerRows] = await connection.query(`SELECT a.id, a.user_id, a.engineer_name AS full_name, a.assignment_count FROM engineer_daily_availability a WHERE a.availability_date = ? AND a.status = 'active' ORDER BY a.last_assigned_at IS NOT NULL ASC, a.last_assigned_at ASC, a.assignment_count ASC, a.joined_at ASC, a.id ASC FOR UPDATE`, [todayManila()]);
    const engineer = (engineerRows as Array<Record<string, unknown>>)[0];
    if (!engineer) { await connection.rollback(); res.status(409).json({ error: 'No Engineer is available today. Ask an Engineer to join the morning availability list.' }); return; }
    const engineerId = engineer.user_id == null ? null : Number(engineer.user_id); const availabilityId = Number(engineer.id); const sourceRecordId = Number(record.id); const engineerName = text(engineer.full_name);
    const deviceModel = deviceModelOverride || text(record.device_model); const productDivision = endorsementDivision(deviceModel, text(record.product_division));
    const [insertResult] = await connection.execute(`INSERT INTO engineer_endorsements (ar_number, frontline_record_id, cso_user_id, engineer_user_id, engineer_name, device_model, issue, product_division) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [arNumber, sourceRecordId, req.user!.userId, engineerId, engineerName, deviceModel, text(record.issue), productDivision]);
    await connection.execute(`UPDATE engineer_daily_availability SET assignment_count = assignment_count + 1, last_assigned_at = CURRENT_TIMESTAMP WHERE id = ?`, [availabilityId]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsed', resourceType: 'engineer_endorsement', resourceId: arNumber, metadata: { engineerUserId: engineerId, productDivision: text(record.product_division) } });
    res.status(201).json({ message: `AR ${arNumber} endorsed to ${engineerName}.`, endorsementId: Number((insertResult as { insertId?: number }).insertId), engineer: { userId: engineerId, name: engineerName }, record: { arNumber, deviceModel, issue: text(record.issue), productDivision } });
  } catch (error) { await connection.rollback(); console.error('endorsement error:', error); res.status(500).json({ error: 'Unable to endorse this record.' }); } finally { connection.release(); }
});

router.put('/calendar-entry', async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const date = text(req.body?.date); const division = text(req.body?.division); const engineer = canonicalEngineerName(text(req.body?.engineer)); const count = Number(req.body?.count); const details = text(req.body?.details);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !division || !engineer || !Number.isInteger(count) || count < 1 || count > 999) { res.status(400).json({ error: 'Date, category, Engineer, and a whole-number count are required.' }); return; }
  await ensureFrontlineTables();
  await getDbPool().execute(`INSERT INTO engineer_calendar_entries (entry_date, product_division, engineer_name, entry_count, details, created_by) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE entry_count=VALUES(entry_count), details=VALUES(details), created_by=VALUES(created_by)`, [date, division, engineer, count, details.slice(0, 1000), req.user!.userId]);
  res.json({ message: 'Calendar entry saved.' });
});

router.post('/:id/pass', async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const id = Number(req.params.id); if (!id) { res.status(400).json({ error: 'A valid endorsement is required.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [endorsementRows] = await connection.query(`SELECT id, engineer_user_id, engineer_name, created_at FROM engineer_endorsements WHERE id = ? FOR UPDATE`, [id]);
    const endorsement = (endorsementRows as Array<Record<string, unknown>>)[0];
    if (!endorsement) { await connection.rollback(); res.status(404).json({ error: 'Endorsement record not found.' }); return; }
    const [latestRows] = await connection.query(`SELECT id FROM engineer_endorsements ORDER BY created_at DESC, id DESC LIMIT 1`);
    if (Number((latestRows as Array<{ id: number }>)[0]?.id) !== id) { await connection.rollback(); res.status(409).json({ error: 'Only the newest endorsement can be passed.' }); return; }
    const currentUserId = endorsement.engineer_user_id == null ? null : Number(endorsement.engineer_user_id); const currentName = text(endorsement.engineer_name);
    const [engineerRows] = await connection.query(`SELECT id, user_id, engineer_name AS full_name FROM engineer_daily_availability WHERE availability_date = ? AND status = 'active' AND NOT (COALESCE(user_id, 0) = COALESCE(?, 0) AND engineer_name = ?) ORDER BY last_assigned_at IS NOT NULL ASC, last_assigned_at ASC, assignment_count ASC, joined_at ASC, id ASC LIMIT 1 FOR UPDATE`, [todayManila(), currentUserId, currentName]);
    const next = (engineerRows as Array<Record<string, unknown>>)[0];
    if (!next) { await connection.rollback(); res.status(409).json({ error: 'No other Engineer is currently available.' }); return; }
    await connection.execute(`UPDATE engineer_endorsements SET engineer_user_id = ?, engineer_name = ? WHERE id = ?`, [next.user_id == null ? null : Number(next.user_id), text(next.full_name), id]);
    await connection.execute(`UPDATE engineer_daily_availability SET assignment_count = GREATEST(assignment_count - 1, 0) WHERE availability_date = ? AND engineer_name = ? AND (COALESCE(user_id, 0) = COALESCE(?, 0))`, [todayManila(), currentName, currentUserId]);
    await connection.execute(`UPDATE engineer_daily_availability SET assignment_count = assignment_count + 1, last_assigned_at = CURRENT_TIMESTAMP WHERE id = ?`, [Number(next.id)]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_passed', resourceType: 'engineer_endorsement', resourceId: String(id), metadata: { fromEngineer: currentName, toEngineer: text(next.full_name) } });
    res.json({ message: `Endorsement passed to ${text(next.full_name)}.`, engineer: text(next.full_name) });
  } catch (error) { await connection.rollback(); console.error('pass endorsement error:', error); res.status(500).json({ error: 'Unable to pass this endorsement.' }); } finally { connection.release(); }
});

router.patch('/:id/engineer', async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const id = Number(req.params.id); const engineerName = canonicalEngineerName(text(req.body?.engineerName));
  if (!id || !engineerName || engineerName.length > 150) { res.status(400).json({ error: 'A valid Engineer name is required.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [endorsementRows] = await connection.query('SELECT id, engineer_user_id, engineer_name FROM engineer_endorsements WHERE id = ? FOR UPDATE', [id]);
    const endorsement = (endorsementRows as Array<Record<string, unknown>>)[0];
    if (!endorsement) { await connection.rollback(); res.status(404).json({ error: 'Endorsement record not found.' }); return; }
    const [rosterRows] = await connection.query('SELECT user_id, engineer_name FROM engineer_roster WHERE active = 1 AND engineer_name = ? LIMIT 1', [engineerName]);
    const engineer = (rosterRows as Array<{ user_id: number | null; engineer_name: string }>)[0];
    if (!engineer) { await connection.rollback(); res.status(404).json({ error: 'Engineer is not active in the roster.' }); return; }
    const previousUserId = endorsement.engineer_user_id == null ? null : Number(endorsement.engineer_user_id);
    const previousName = text(endorsement.engineer_name);
    if (previousUserId === (engineer.user_id == null ? null : Number(engineer.user_id)) && previousName === engineer.engineer_name) { await connection.commit(); res.json({ message: 'Engineer assignment unchanged.', engineer: engineer.engineer_name }); return; }
    await connection.execute('UPDATE engineer_endorsements SET engineer_user_id = ?, engineer_name = ? WHERE id = ?', [engineer.user_id == null ? null : Number(engineer.user_id), engineer.engineer_name, id]);
    await connection.execute('UPDATE engineer_daily_availability SET assignment_count = GREATEST(assignment_count - 1, 0) WHERE availability_date = ? AND engineer_name = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)', [todayManila(), previousName, previousUserId]);
    await connection.execute('UPDATE engineer_daily_availability SET assignment_count = assignment_count + 1 WHERE availability_date = ? AND status = \'active\' AND engineer_name = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)', [todayManila(), engineer.engineer_name, engineer.user_id == null ? null : Number(engineer.user_id)]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_engineer_updated', resourceType: 'engineer_endorsement', resourceId: String(id), metadata: { fromEngineer: previousName, toEngineer: engineer.engineer_name } });
    res.json({ message: `Endorsement assigned to ${engineer.engineer_name}.`, engineer: engineer.engineer_name });
  } catch (error) { await connection.rollback(); console.error('update endorsement engineer error:', error); res.status(500).json({ error: 'Unable to update the Engineer assignment.' }); } finally { connection.release(); }
});

router.post('/:id/cancel', async (req, res) => {
  if (!canEndorse(req)) { forbidden(res); return; }
  const id = Number(req.params.id); if (!id) { res.status(400).json({ error: 'A valid endorsement is required.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT id, engineer_user_id, engineer_name, created_at FROM engineer_endorsements WHERE id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 SECOND) FOR UPDATE`, [id]);
    const endorsement = (rows as Array<Record<string, unknown>>)[0];
    if (!endorsement) { await connection.rollback(); res.status(409).json({ error: 'The 5-second cancel window has expired.' }); return; }
    const engineerUserId = endorsement.engineer_user_id == null ? null : Number(endorsement.engineer_user_id);
    await connection.execute('DELETE FROM engineer_endorsements WHERE id = ?', [id]);
    await connection.execute(`UPDATE engineer_daily_availability SET assignment_count = GREATEST(assignment_count - 1, 0) WHERE availability_date = ? AND engineer_name = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)`, [todayManila(), text(endorsement.engineer_name), engineerUserId]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_cancelled', resourceType: 'engineer_endorsement', resourceId: String(id), metadata: { engineerName: text(endorsement.engineer_name) } });
    res.json({ message: 'Endorsement cancelled.' });
  } catch (error) { await connection.rollback(); console.error('cancel endorsement error:', error); res.status(500).json({ error: 'Unable to cancel this endorsement.' }); } finally { connection.release(); }
});

router.delete('/:id', async (req, res) => {
  if (!canDeleteEndorsement(req)) { forbidden(res); return; }
  const id = Number(req.params.id); if (!id) { res.status(400).json({ error: 'A valid endorsement is required.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT id, engineer_user_id, engineer_name FROM engineer_endorsements WHERE id = ? FOR UPDATE', [id]);
    const endorsement = (rows as Array<Record<string, unknown>>)[0];
    if (!endorsement) { await connection.rollback(); res.status(404).json({ error: 'Endorsement record not found.' }); return; }
    const engineerUserId = endorsement.engineer_user_id == null ? null : Number(endorsement.engineer_user_id);
    await connection.execute('DELETE FROM engineer_endorsements WHERE id = ?', [id]);
    await connection.execute(`UPDATE engineer_daily_availability SET assignment_count = GREATEST(assignment_count - 1, 0) WHERE availability_date = ? AND engineer_name = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)`, [todayManila(), text(endorsement.engineer_name), engineerUserId]);
    await connection.commit();
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_deleted', resourceType: 'engineer_endorsement', resourceId: String(id), metadata: { engineerName: text(endorsement.engineer_name) } });
    res.json({ message: 'Endorsement deleted. The Frontline record was not changed.' });
  } catch (error) { await connection.rollback(); console.error('delete endorsement error:', error); res.status(500).json({ error: 'Unable to delete this endorsement.' }); } finally { connection.release(); }
});

router.patch('/:id', async (req, res) => {
  if (!canEditCalendar(req)) { forbidden(res); return; }
  const id = Number(req.params.id); const deviceModel = text(req.body?.deviceModel);
  if (!id || !deviceModel || deviceModel.length > 150) { res.status(400).json({ error: 'A valid device model is required.' }); return; }
  await ensureFrontlineTables();
  const [result] = await getDbPool().execute('UPDATE engineer_endorsements SET device_model = ? WHERE id = ?', [deviceModel, id]);
  if (!Number((result as { affectedRows?: number }).affectedRows)) { res.status(404).json({ error: 'Endorsement record not found.' }); return; }
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'engineer.endorsement_device_model_updated', resourceType: 'engineer_endorsement', resourceId: String(id), metadata: { deviceModel } });
  res.json({ message: 'Device model updated.', deviceModel });
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
