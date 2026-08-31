import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../auth.js';
import { getDbPool } from '../db/index.js';
import { ensureStorageTables } from './store.js';

const router = Router();
router.use(authenticateToken);

const RULES = [
  { family: 'IOS', status: 'Ready for Pickup', numbers: [1, 2, 3, 4, 9, 10, 11, 12] },
  { family: 'IOS', status: 'Awaiting Parts', numbers: [5, 6, 13, 14] },
  { family: 'IOS', status: 'Awaiting Repair', numbers: [7, 8, 15, 16] },
  { family: 'Mac', status: 'Abandoned Units', numbers: Array.from({ length: 24 }, (_, i) => i + 1) },
  { family: 'Mac', status: 'Awaiting Repair', numbers: Array.from({ length: 12 }, (_, i) => i + 37) },
  { family: 'Mac', status: 'Awaiting Parts', numbers: Array.from({ length: 12 }, (_, i) => i + 49) },
  { family: 'Mac', status: 'Ready for Pickup', numbers: Array.from({ length: 24 }, (_, i) => i + 73) },
] as const;

function value(input: unknown) { return String(input ?? '').trim(); }
function employeeNumber(input: unknown) { return value(input).toUpperCase(); }
function findRule(family: string, status: string) { return RULES.find((rule) => rule.family === family && rule.status === status); }
function bad(res: any, message: string, code = 400) { res.status(code).json({ error: message }); }

async function getEmployee(number: unknown) {
  const [rows] = await getDbPool().query('SELECT id, employee_number AS employeeNumber, full_name AS fullName FROM storage_employees WHERE employee_number = ? AND active = 1 LIMIT 1', [employeeNumber(number)]);
  return (rows as Array<{ id: number; employeeNumber: string; fullName: string }>)[0];
}

router.get('/rules', async (_req, res) => { await ensureStorageTables(); res.json({ rules: RULES }); });

router.get('/employees/verify', async (req, res) => {
  await ensureStorageTables();
  const employee = await getEmployee(req.query.employeeNumber);
  if (!employee) { bad(res, 'Employee number not found.', 404); return; }
  res.json({ employee });
});

router.get('/employees', requireAdmin, async (_req, res) => {
  await ensureStorageTables();
  const [rows] = await getDbPool().query('SELECT id, employee_number AS employeeNumber, full_name AS fullName, active, created_at AS createdAt, updated_at AS updatedAt FROM storage_employees ORDER BY active DESC, full_name ASC');
  res.json(rows);
});

router.post('/employees', requireAdmin, async (req, res) => {
  const number = employeeNumber(req.body?.employeeNumber); const name = value(req.body?.fullName);
  if (!number || !name || number.length > 50 || name.length > 255) { bad(res, 'Employee number and full name are required.'); return; }
  await ensureStorageTables();
  try {
    const [result] = await getDbPool().execute('INSERT INTO storage_employees (employee_number, full_name, active, created_by) VALUES (?, ?, 1, ?)', [number, name, req.user!.userId]);
    res.status(201).json({ id: Number((result as { insertId: number }).insertId), employeeNumber: number, fullName: name });
  } catch (error) { if (String((error as Error).message).includes('Duplicate')) { bad(res, 'That employee number already exists.', 409); return; } throw error; }
});

router.patch('/employees/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id); const number = employeeNumber(req.body?.employeeNumber); const name = value(req.body?.fullName); const active = req.body?.active === false ? 0 : 1;
  if (!id || !number || !name) { bad(res, 'Employee number and full name are required.'); return; }
  await ensureStorageTables();
  try { await getDbPool().execute('UPDATE storage_employees SET employee_number = ?, full_name = ?, active = ? WHERE id = ?', [number, name, active, id]); res.json({ message: 'Employee updated.' }); }
  catch (error) { if (String((error as Error).message).includes('Duplicate')) { bad(res, 'That employee number already exists.', 409); return; } throw error; }
});

router.get('/overview', async (_req, res) => {
  await ensureStorageTables();
  const [rows] = await getDbPool().query(`SELECT u.id, u.ar_number, u.family, u.status, u.cabinet_number, u.checked_in_at, e.full_name AS employee_name FROM storage_units u LEFT JOIN storage_employees e ON e.id = u.current_employee_id WHERE u.state = 'in' ORDER BY u.family, u.cabinet_number`);
  res.json({ occupied: rows, rules: RULES });
});

router.get('/units/:arNumber', async (req, res) => {
  await ensureStorageTables();
  const ar = value(req.params.arNumber);
  const [unitRows] = await getDbPool().query(`SELECT u.id, u.ar_number, u.family, u.status, u.cabinet_number, u.state, u.checked_in_at, u.checked_out_at, e.full_name AS current_employee_name FROM storage_units u LEFT JOIN storage_employees e ON e.id = u.current_employee_id WHERE u.ar_number = ? LIMIT 1`, [ar]);
  const unit = (unitRows as Array<Record<string, unknown>>)[0];
  if (!unit) { res.json({ unit: null, history: [] }); return; }
  const [history] = await getDbPool().query(`SELECT m.id, m.action, m.family, m.status, m.cabinet_number, m.occurred_at, e.employee_number, e.full_name FROM storage_movements m INNER JOIN storage_employees e ON e.id = m.employee_id WHERE m.unit_id = ? ORDER BY m.occurred_at DESC, m.id DESC`, [unit.id]);
  res.json({ unit, history });
});

router.post('/units/in', async (req, res) => {
  const ar = value(req.body?.arNumber); const family = value(req.body?.family); const status = value(req.body?.status); const cabinet = Number(req.body?.cabinetNumber); const employee = await getEmployee(req.body?.employeeNumber);
  if (!employee) { bad(res, 'Verify the employee number first.', 403); return; }
  const rule = findRule(family, status);
  if (!ar || !rule || !rule.numbers.includes(cabinet as never)) { bad(res, 'Choose a valid cabinet for this family and status.'); return; }
  await ensureStorageTables(); const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query('SELECT id, state FROM storage_units WHERE ar_number = ? FOR UPDATE', [ar]);
    const existing = (existingRows as Array<{ id: number; state: string }>)[0];
    if (existing?.state === 'in') { await connection.rollback(); bad(res, 'This unit is already IN. Check its current location above.', 409); return; }
    const [occupiedRows] = await connection.query('SELECT ar_number FROM storage_units WHERE state = \'in\' AND family = ? AND cabinet_number = ? LIMIT 1 FOR UPDATE', [family, cabinet]);
    if ((occupiedRows as Array<Record<string, unknown>>).length) { await connection.rollback(); bad(res, 'That cabinet is already occupied.', 409); return; }
    let unitId: number;
    if (existing) { unitId = existing.id; await connection.execute(`UPDATE storage_units SET family = ?, status = ?, cabinet_number = ?, state = 'in', current_employee_id = ?, checked_in_at = CURRENT_TIMESTAMP, checked_out_at = NULL WHERE id = ?`, [family, status, cabinet, employee.id, existing.id]); }
    else { const [insert] = await connection.execute(`INSERT INTO storage_units (ar_number, family, status, cabinet_number, state, current_employee_id, checked_in_at) VALUES (?, ?, ?, ?, 'in', ?, CURRENT_TIMESTAMP)`, [ar, family, status, cabinet, employee.id]); unitId = Number((insert as { insertId: number }).insertId); }
    await connection.execute('INSERT INTO storage_movements (unit_id, employee_id, action, family, status, cabinet_number) VALUES (?, ?, \'IN\', ?, ?, ?)', [unitId, employee.id, family, status, cabinet]);
    await connection.commit(); res.status(201).json({ message: `${ar} checked in to ${family} ${String(cabinet).padStart(2, '0')}.` });
  } catch (error) { await connection.rollback(); console.error('storage check-in error:', error); res.status(500).json({ error: 'Unable to check in this unit.' }); } finally { connection.release(); }
});

router.post('/units/out', async (req, res) => {
  const ar = value(req.body?.arNumber); const employee = await getEmployee(req.body?.employeeNumber);
  if (!employee) { bad(res, 'Verify the employee number first.', 403); return; }
  await ensureStorageTables(); const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT id, family, status, cabinet_number, state FROM storage_units WHERE ar_number = ? FOR UPDATE', [ar]);
    const unit = (rows as Array<{ id: number; family: string; status: string; cabinet_number: number; state: string }>)[0];
    if (!unit) { await connection.rollback(); bad(res, 'No stored unit found for this AR number.', 404); return; }
    if (unit.state !== 'in') { await connection.rollback(); bad(res, 'This unit is already OUT.', 409); return; }
    await connection.execute(`UPDATE storage_units SET state = 'out', current_employee_id = NULL, checked_out_at = CURRENT_TIMESTAMP WHERE id = ?`, [unit.id]);
    await connection.execute('INSERT INTO storage_movements (unit_id, employee_id, action, family, status, cabinet_number) VALUES (?, ?, \'OUT\', ?, ?, ?)', [unit.id, employee.id, unit.family, unit.status, unit.cabinet_number]);
    await connection.commit(); res.json({ message: `${ar} checked out from ${unit.family} ${String(unit.cabinet_number).padStart(2, '0')}.` });
  } catch (error) { await connection.rollback(); console.error('storage check-out error:', error); res.status(500).json({ error: 'Unable to check out this unit.' }); } finally { connection.release(); }
});

export default router;
