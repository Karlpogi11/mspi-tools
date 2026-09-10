import { Router } from 'express';
import crypto from 'crypto';
import Excel from 'exceljs';
import { authenticateToken, requireAdmin } from '../auth.js';
import { getDbPool } from '../db/index.js';
import { ensurePartsTables } from './store.js';
import { resolveByEee, resolveByPartNumber, resolveBySerial, invalidateEeeIndex, type ResolvedPart } from './eee.js';
import {
  appendSheetRow,
  connectUrl,
  connectionFor,
  decodeState,
  frontendUrl,
  listSheets,
  saveConnection,
  exchangeCode,
  sheetConfig,
  type SheetLogRow,
} from './sheets.js';

const router = Router();
router.use(authenticateToken);

function value(input: unknown) { return String(input ?? '').trim(); }
function upper(input: unknown) { return value(input).toUpperCase(); }
function bad(res: any, message: string, code = 400) { res.status(code).json({ error: message }); }
function todayYmD() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function parseDate(input: unknown): string | null {
  const raw = value(input);
  if (!raw) return todayYmD();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const time = Date.parse(`${raw}T00:00:00Z`);
  return Number.isNaN(time) ? null : raw;
}

interface Site { id: number; code: string; name: string; active: number }

async function getSite(code: unknown) {
  const [rows] = await getDbPool().query('SELECT id, code, name, active FROM parts_sites WHERE code = ? LIMIT 1', [upper(code)]);
  const site = (rows as Site[])[0];
  if (!site || !site.active) return null;
  return site;
}

function isPrivileged(req: any) {
  return req.user?.isSuperAdmin || req.user?.roleName === 'Admin';
}

/**
 * Signed site lock. Verify returns a token binding {user, site} for 24h;
 * every site-scoped endpoint below pins non-admin callers to that site, so a
 * podium session can never read or move another site's stock — even by
 * passing a different siteCode. Admins bypass and may use ALL.
 */
export function signSiteToken(userId: number, site: Site): string {
  const payload = Buffer.from(JSON.stringify({ userId, siteId: site.id, code: site.code, exp: Date.now() + 24 * 60 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function tokenSite(token: unknown, userId: number): { id: number; code: string } | null {
  try {
    const [payload, signature] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: number; siteId?: number; code?: string; exp?: number };
    if (data.userId !== userId || !data.siteId || !data.code || !(data.exp! > Date.now())) return null;
    return { id: data.siteId, code: data.code };
  } catch { return null; }
}

interface Scope { site: Site | null; all: boolean }

/** Resolve the caller's scope. Sends 403/404 and returns null when rejected. */
export async function resolveScope(req: any, res: any): Promise<Scope | null> {
  const code = upper(req.query?.siteCode || req.body?.siteCode);
  const token = req.headers['x-site-token'] || req.body?.siteToken || req.query?.siteToken;
  if (isPrivileged(req)) {
    if (code && code !== 'ALL') {
      const site = await getSite(code);
      if (!site) { bad(res, 'Site code not found.', 404); return null; }
      return { site, all: false };
    }
    // Admin verified into a site (token present) but the call carries no
    // siteCode — pin to the verified site instead of failing.
    const pinned = tokenSite(token, req.user!.userId);
    if (pinned) {
      const site = await getSite(pinned.code);
      if (site) return { site, all: false };
    }
    return { site: null, all: true };
  }
  const pinned = tokenSite(token, req.user!.userId);
  if (!pinned) { bad(res, 'Verify the site code first.', 403); return null; }
  if (code && code !== 'ALL' && code !== pinned.code) { bad(res, `This session is locked to site ${pinned.code}.`, 403); return null; }
  const site = await getSite(pinned.code);
  if (!site) { bad(res, 'Site code not found.', 404); return null; }
  return { site, all: false };
}

class StockError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Core IN logic — runs inside the caller's transaction. */
async function applyStockIn(
  conn: any,
  ctx: { site: Site; partNumber: string; serial: string; quantity: number; occurredDate: string; actorUserId: number }
): Promise<{ movementId: number; sheetRow: SheetLogRow; message: string }> {
  const [masterRows] = await conn.query('SELECT part_number, description, eee_code, substitute_part, serialized FROM parts_master WHERE part_number = ? LIMIT 1', [ctx.partNumber]);
  let master = (masterRows as ResolvedPart[])[0];
  if (!master && ctx.serial) {
    // New serial, no part number typed: identify the part from the EEE code inside the serial.
    const found = await resolveBySerial(ctx.serial);
    if (found) {
      ctx.partNumber = found.part.part_number;
      const [retry] = await conn.query('SELECT part_number, description, eee_code, substitute_part, serialized FROM parts_master WHERE part_number = ? LIMIT 1', [ctx.partNumber]);
      master = (retry as ResolvedPart[])[0];
    }
  }
  if (!master) throw new StockError(`"${ctx.partNumber || ctx.serial}" is not in the parts master. Ask an admin to add it first.`, 404);

  const serialized = String(master.serialized || 'Y').toUpperCase() !== 'N';
  if (!serialized) {
    if (ctx.serial) throw new StockError(`"${ctx.partNumber}" is a non-serialized part — leave the serial empty and enter a quantity.`, 400);
    if (!Number.isInteger(ctx.quantity) || ctx.quantity < 1) throw new StockError('Quantity must be at least 1.', 400);
    const [rows] = await conn.query('SELECT id, quantity, status FROM parts_units WHERE site_id = ? AND part_number = ? AND serial IS NULL LIMIT 1 FOR UPDATE', [ctx.site.id, ctx.partNumber]);
    const existing = (rows as Array<{ id: number; quantity: number; status: string }>)[0];
    if (existing) {
      await conn.execute(`UPDATE parts_units SET quantity = quantity + ?, status = 'in', occurred_date = ?, stocked_in_at = CURRENT_TIMESTAMP, stocked_out_at = NULL, created_by = ? WHERE id = ?`, [ctx.quantity, ctx.occurredDate, ctx.actorUserId, existing.id]);
    } else {
      await conn.execute(`INSERT INTO parts_units (site_id, part_number, serial, quantity, status, occurred_date, stocked_in_at, created_by) VALUES (?, ?, NULL, ?, 'in', ?, CURRENT_TIMESTAMP, ?)`, [ctx.site.id, ctx.partNumber, ctx.quantity, ctx.occurredDate, ctx.actorUserId]);
    }
    const [insert] = await conn.execute(`INSERT INTO parts_movements (site_id, part_number, serial, type, occurred_date, reference, quantity, actor_user_id) VALUES (?, ?, NULL, 'IN', ?, NULL, ?, ?)`, [ctx.site.id, ctx.partNumber, ctx.occurredDate, ctx.quantity, ctx.actorUserId]);
    const movementId = Number((insert as { insertId: number }).insertId);
    return {
      movementId,
      sheetRow: { siteCode: ctx.site.code, siteName: ctx.site.name, type: 'IN', date: ctx.occurredDate, partNumber: ctx.partNumber, description: master.description, serial: '', reference: '', quantity: ctx.quantity, actor: '' },
      message: `${ctx.quantity} × ${ctx.partNumber} stocked in at ${ctx.site.code}.`,
    };
  }

  if (!ctx.serial) throw new StockError('Serial number is required for this part.', 400);
  const [rows] = await conn.query('SELECT id, status, site_id FROM parts_units WHERE serial = ? LIMIT 1 FOR UPDATE', [ctx.serial]);
  const existing = (rows as Array<{ id: number; status: string; site_id: number }>)[0];
  if (existing?.status === 'in') {
    const [siteRows] = await conn.query('SELECT code FROM parts_sites WHERE id = ? LIMIT 1', [existing.site_id]);
    const where = (siteRows as Array<{ code: string }>)[0]?.code || 'another site';
    throw new StockError(`Serial ${ctx.serial} is already in stock at ${where}.`, 409);
  }
  if (existing) {
    await conn.execute(`UPDATE parts_units SET site_id = ?, part_number = ?, quantity = 1, status = 'in', reference = NULL, occurred_date = ?, stocked_in_at = CURRENT_TIMESTAMP, stocked_out_at = NULL, created_by = ? WHERE id = ?`, [ctx.site.id, ctx.partNumber, ctx.occurredDate, ctx.actorUserId, existing.id]);
  } else {
    await conn.execute(`INSERT INTO parts_units (site_id, part_number, serial, quantity, status, occurred_date, stocked_in_at, created_by) VALUES (?, ?, ?, 1, 'in', ?, CURRENT_TIMESTAMP, ?)`, [ctx.site.id, ctx.partNumber, ctx.serial, ctx.occurredDate, ctx.actorUserId]);
  }
  const [insert] = await conn.execute(`INSERT INTO parts_movements (site_id, part_number, serial, type, occurred_date, reference, quantity, actor_user_id) VALUES (?, ?, ?, 'IN', ?, NULL, 1, ?)`, [ctx.site.id, ctx.partNumber, ctx.serial, ctx.occurredDate, ctx.actorUserId]);
  const movementId = Number((insert as { insertId: number }).insertId);
  return {
    movementId,
    sheetRow: { siteCode: ctx.site.code, siteName: ctx.site.name, type: 'IN', date: ctx.occurredDate, partNumber: ctx.partNumber, description: master.description, serial: ctx.serial, reference: '', quantity: 1, actor: '' },
    message: `${ctx.serial} (${ctx.partNumber}) stocked in at ${ctx.site.code}.`,
  };
}

/** Core OUT logic — runs inside the caller's transaction. */
async function applyStockOut(
  conn: any,
  ctx: { site: Site; partNumber: string; serial: string; quantity: number; reference: string; occurredDate: string; actorUserId: number }
): Promise<{ movementId: number; sheetRow: SheetLogRow; message: string }> {
  if (!ctx.reference) throw new StockError('Reference number is required for stock out.', 400);
  const [masterRows] = await conn.query('SELECT part_number, description, serialized FROM parts_master WHERE part_number = ? LIMIT 1', [ctx.partNumber || '__none__']);
  const master = (masterRows as ResolvedPart[])[0];
  const serialized = !master || String(master.serialized || 'Y').toUpperCase() !== 'N';

  if (serialized) {
    if (!ctx.serial) {
      if (ctx.partNumber && master) throw new StockError(`"${ctx.partNumber}" is a serialized part — scan the serial number to stock it out.`, 400);
      throw new StockError('Serial number is required for stock out.', 400);
    }
    const [rows] = await conn.query('SELECT id, site_id, part_number, status FROM parts_units WHERE serial = ? LIMIT 1 FOR UPDATE', [ctx.serial]);
    const unit = (rows as Array<{ id: number; site_id: number; part_number: string; status: string }>)[0];
    if (!unit) throw new StockError(`No stock record found for serial ${ctx.serial}.`, 404);
    if (unit.status !== 'in') throw new StockError(`Serial ${ctx.serial} is already out of stock.`, 409);
    if (unit.site_id !== ctx.site.id) {
      const [siteRows] = await conn.query('SELECT code FROM parts_sites WHERE id = ? LIMIT 1', [unit.site_id]);
      throw new StockError(`Serial ${ctx.serial} belongs to site ${(siteRows as Array<{ code: string }>)[0]?.code || 'another site'}.`, 403);
    }
    const [descRows] = await conn.query('SELECT description FROM parts_master WHERE part_number = ? LIMIT 1', [unit.part_number]);
    const description = (descRows as Array<{ description: string }>)[0]?.description || '';
    await conn.execute(`UPDATE parts_units SET status = 'out', reference = ?, stocked_out_at = CURRENT_TIMESTAMP, created_by = ? WHERE id = ?`, [ctx.reference, ctx.actorUserId, unit.id]);
    const [insert] = await conn.execute(`INSERT INTO parts_movements (site_id, part_number, serial, type, occurred_date, reference, quantity, actor_user_id) VALUES (?, ?, ?, 'OUT', ?, ?, 1, ?)`, [ctx.site.id, unit.part_number, ctx.serial, ctx.occurredDate, ctx.reference, ctx.actorUserId]);
    const movementId = Number((insert as { insertId: number }).insertId);
    return {
      movementId,
      sheetRow: { siteCode: ctx.site.code, siteName: ctx.site.name, type: 'OUT', date: ctx.occurredDate, partNumber: unit.part_number, description, serial: ctx.serial, reference: ctx.reference, quantity: 1, actor: '' },
      message: `${ctx.serial} stocked out from ${ctx.site.code} (ref ${ctx.reference}).`,
    };
  }

  // Non-serialized OUT by part + quantity.
  if (!Number.isInteger(ctx.quantity) || ctx.quantity < 1) throw new StockError('Quantity must be at least 1.', 400);
  const [rows] = await conn.query('SELECT id, quantity, status FROM parts_units WHERE site_id = ? AND part_number = ? AND serial IS NULL LIMIT 1 FOR UPDATE', [ctx.site.id, ctx.partNumber]);
  const balance = (rows as Array<{ id: number; quantity: number; status: string }>)[0];
  const available = balance && balance.status === 'in' ? balance.quantity : 0;
  if (available < ctx.quantity) throw new StockError(`Only ${available} × ${ctx.partNumber} in stock at ${ctx.site.code}.`, 409);
  const remaining = available - ctx.quantity;
  await conn.execute(`UPDATE parts_units SET quantity = ?, status = ?, reference = ?, stocked_out_at = CURRENT_TIMESTAMP, created_by = ? WHERE id = ?`, [remaining, remaining > 0 ? 'in' : 'out', ctx.reference, ctx.actorUserId, balance!.id]);
  const [insert] = await conn.execute(`INSERT INTO parts_movements (site_id, part_number, serial, type, occurred_date, reference, quantity, actor_user_id) VALUES (?, ?, NULL, 'OUT', ?, ?, ?, ?)`, [ctx.site.id, ctx.partNumber, ctx.occurredDate, ctx.reference, ctx.quantity, ctx.actorUserId]);
  const movementId = Number((insert as { insertId: number }).insertId);
  return {
    movementId,
    sheetRow: { siteCode: ctx.site.code, siteName: ctx.site.name, type: 'OUT', date: ctx.occurredDate, partNumber: ctx.partNumber, description: master!.description, serial: '', reference: ctx.reference, quantity: ctx.quantity, actor: '' },
    message: `${ctx.quantity} × ${ctx.partNumber} stocked out from ${ctx.site.code} (ref ${ctx.reference}).`,
  };
}

async function markSheetSynced(movementId: number) {
  try {
    await getDbPool().query('UPDATE parts_movements SET sheet_synced = 1 WHERE id = ?', [movementId]);
  } catch { /* best effort */ }
}

async function withConnection<T>(fn: (conn: any) => Promise<T>): Promise<T> {
  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
}

function stockError(res: any, error: unknown) {
  if (error instanceof StockError) { bad(res, error.message, error.status); return; }
  console.error('parts stock error:', error);
  res.status(500).json({ error: 'Unable to save this stock movement.' });
}

// ---------- Sites ----------

router.get('/sites/verify', async (req, res) => {
  await ensurePartsTables();
  const site = await getSite(req.query.code);
  if (!site) { bad(res, 'Site code not found. Check the code and try again.', 404); return; }
  res.json({ site, siteToken: signSiteToken(req.user!.userId, site) });
});

router.get('/sites', requireAdmin, async (_req, res) => {
  await ensurePartsTables();
  const [rows] = await getDbPool().query('SELECT id, code, name, active FROM parts_sites ORDER BY active DESC, code ASC');
  res.json({ sites: rows });
});

router.post('/sites', requireAdmin, async (req, res) => {
  const code = upper(req.body?.code); const name = value(req.body?.name);
  if (!code || !name || code.length > 30 || name.length > 255) { bad(res, 'Site code and name are required.'); return; }
  await ensurePartsTables();
  try {
    const [result] = await getDbPool().execute('INSERT INTO parts_sites (code, name, active, created_by) VALUES (?, ?, 1, ?)', [code, name, req.user!.userId]);
    res.status(201).json({ id: Number((result as { insertId: number }).insertId), code, name });
  } catch (error) { if (String((error as Error).message).includes('Duplicate')) { bad(res, 'That site code already exists.', 409); return; } throw error; }
});

router.patch('/sites/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const code = upper(req.body?.code); const name = value(req.body?.name);
  const active = req.body?.active === false ? 0 : 1;
  if (!id || !code || !name) { bad(res, 'Site code and name are required.'); return; }
  await ensurePartsTables();
  try {
    await getDbPool().execute('UPDATE parts_sites SET code = ?, name = ?, active = ? WHERE id = ?', [code, name, active, id]);
    res.json({ message: 'Site updated.' });
  } catch (error) { if (String((error as Error).message).includes('Duplicate')) { bad(res, 'That site code already exists.', 409); return; } throw error; }
});

router.delete('/sites/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { bad(res, 'Site is required.'); return; }
  await ensurePartsTables();
  const [result] = await getDbPool().execute('DELETE FROM parts_sites WHERE id = ?', [id]);
  if ((result as { affectedRows: number }).affectedRows === 0) { bad(res, 'Site not found.', 404); return; }
  res.json({ message: 'Site removed along with its stock records.' });
});

// ---------- Parts master ----------

function parseMasterItem(raw: any): { part_number: string; description: string; eee_code: string | null; substitute_part: string | null; serialized: string } | null {
  const part_number = value(raw?.part_number || raw?.partNumber);
  const description = value(raw?.description);
  if (!part_number || !description || part_number.length > 150) return null;
  const eee_code = value(raw?.eee_code || raw?.eeeCode || raw?.eee) || null;
  const substitute_part = value(raw?.substitute_part || raw?.substitutePart) || null;
  const serialized = String(raw?.serialized ?? 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y';
  return { part_number, description, eee_code, substitute_part, serialized };
}

function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
}

router.get('/master', async (req, res) => {
  await ensurePartsTables();
  const q = value(req.query.q);
  const limit = Math.min(Math.max(Number(req.query.limit) || (q ? 200 : 1000), 1), 12000);
  const safeLimit = Number.isInteger(limit) ? limit : 1000;
  const pool = getDbPool();
  const terms = searchTerms(q);
  const [rows] = terms.length
    ? await pool.query(
      `SELECT id, part_number, description, eee_code, substitute_part, serialized FROM parts_master
       WHERE ${terms.map(() => '(part_number LIKE ? OR description LIKE ? OR eee_code LIKE ?)').join(' AND ')}
       ORDER BY part_number ASC LIMIT ${safeLimit}`,
      terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`]),
    )
    : await pool.query(`SELECT id, part_number, description, eee_code, substitute_part, serialized FROM parts_master ORDER BY part_number ASC LIMIT ${safeLimit}`);
  res.json({ items: rows });
});

/**
 * Podium quick-add: any authenticated user may CREATE a missing master entry
 * (create-only — never overwrites an existing row, so podium staff can't
 * clobber admin catalog data). Edit/delete/import stay admin-only.
 */
router.post('/master/ensure', async (req, res) => {
  const item = parseMasterItem(req.body);
  if (!item) { bad(res, 'Part number and description are required to add this part.'); return; }
  await ensurePartsTables();
  const [existing] = await getDbPool().query('SELECT id, part_number, description, eee_code, substitute_part, serialized FROM parts_master WHERE part_number = ? LIMIT 1', [item.part_number]);
  const found = (existing as ResolvedPart[])[0];
  if (found) { res.json({ item: found, created: false }); return; }
  try {
    const [result] = await getDbPool().execute('INSERT INTO parts_master (part_number, description, eee_code, substitute_part, serialized, created_by) VALUES (?, ?, ?, ?, ?, ?)', [item.part_number, item.description, item.eee_code, item.substitute_part, item.serialized, req.user!.userId]);
    invalidateEeeIndex();
    res.status(201).json({ item: { id: Number((result as { insertId: number }).insertId), ...item }, created: true });
  } catch (error) {
    if (String((error as Error).message).includes('Duplicate')) {
      const [retry] = await getDbPool().query('SELECT id, part_number, description, eee_code, substitute_part, serialized FROM parts_master WHERE part_number = ? LIMIT 1', [item.part_number]);
      res.json({ item: (retry as ResolvedPart[])[0], created: false });
      return;
    }
    throw error;
  }
});

router.post('/master', requireAdmin, async (req, res) => {  const item = parseMasterItem(req.body);
  if (!item) { bad(res, 'Part number and description are required.'); return; }
  await ensurePartsTables();
  try {
    const [result] = await getDbPool().execute('INSERT INTO parts_master (part_number, description, eee_code, substitute_part, serialized, created_by) VALUES (?, ?, ?, ?, ?, ?)', [item.part_number, item.description, item.eee_code, item.substitute_part, item.serialized, req.user!.userId]);
    invalidateEeeIndex();
    res.status(201).json({ id: Number((result as { insertId: number }).insertId), ...item });
  } catch (error) { if (String((error as Error).message).includes('Duplicate')) { bad(res, 'That part number is already in the master list.', 409); return; } throw error; }
});

router.put('/master/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const item = parseMasterItem(req.body);
  if (!id || !item) { bad(res, 'Part number and description are required.'); return; }
  await ensurePartsTables();
  try {
    await getDbPool().execute('UPDATE parts_master SET part_number = ?, description = ?, eee_code = ?, substitute_part = ?, serialized = ? WHERE id = ?', [item.part_number, item.description, item.eee_code, item.substitute_part, item.serialized, id]);
    invalidateEeeIndex();
    res.json({ message: 'Part updated.' });
  } catch (error) { if (String((error as Error).message).includes('Duplicate')) { bad(res, 'That part number is already in the master list.', 409); return; } throw error; }
});

router.delete('/master/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { bad(res, 'Part is required.'); return; }
  await ensurePartsTables();
  const [result] = await getDbPool().execute('DELETE FROM parts_master WHERE id = ?', [id]);
  if ((result as { affectedRows: number }).affectedRows === 0) { bad(res, 'Part not found.', 404); return; }
  invalidateEeeIndex();
  res.json({ message: 'Part removed from the master list. Stock history was preserved.' });
});

router.post('/master/import', requireAdmin, async (req, res) => {
  const raw: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = raw.map(parseMasterItem).filter((x): x is NonNullable<ReturnType<typeof parseMasterItem>> => x !== null);
  if (!items.length) { bad(res, 'No valid rows to import. Need Part Number and Description columns.'); return; }
  await ensurePartsTables();
  const unique = new Map<string, (typeof items)[number]>(items.map((item) => [item.part_number, item]));
  const entries = [...unique.values()];
  let added = 0; let updated = 0;
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const [before] = await getDbPool().query('SELECT part_number FROM parts_master WHERE part_number IN (?)', [chunk.map((c) => c.part_number)]);
    const existing = new Set((before as Array<{ part_number: string }>).map((r) => r.part_number));
    added += chunk.filter((c) => !existing.has(c.part_number)).length;
    updated += chunk.filter((c) => existing.has(c.part_number)).length;
    for (const item of chunk) {
      await getDbPool().execute(
        `INSERT INTO parts_master (part_number, description, eee_code, substitute_part, serialized, created_by) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description), eee_code = VALUES(eee_code), substitute_part = VALUES(substitute_part), serialized = VALUES(serialized)`,
        [item.part_number, item.description, item.eee_code, item.substitute_part, item.serialized, req.user!.userId]
      );
    }
  }
  invalidateEeeIndex();
  res.json({ added, updated, count: entries.length });
});

// ---------- Templates ----------

function templateWorkbook(kind: 'in' | 'out') {
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet(kind === 'in' ? 'Stock In' : 'Stock Out');
  const headers = kind === 'in' ? ['Date', 'Part Number', 'Serial'] : ['Date', 'Serial', 'Reference', 'Part Number'];
  ws.getCell('A1').value = kind === 'in' ? 'STOCK IN — Date, Part Number, Serial' : 'STOCK OUT — Date, Serial, Reference (required), Part Number';
  ws.getCell('A1').font = { bold: true, size: 12 };
  headers.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  headers.forEach((_, i) => { ws.getColumn(i + 1).width = 22; });
  return wb;
}

router.get('/template/in', async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="parts-stock-in-template.xlsx"');
  await templateWorkbook('in').xlsx.write(res);
  res.end();
});

router.get('/template/out', async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="parts-stock-out-template.xlsx"');
  await templateWorkbook('out').xlsx.write(res);
  res.end();
});

// ---------- Resolve / lookup / stock ----------

router.get('/resolve', async (req, res) => {
  await ensurePartsTables();
  const serial = upper(req.query.serial); const partNumber = value(req.query.partNumber); const eee = upper(req.query.eee);
  const scope = await resolveScope(req, res);
  if (!scope) return;
  let part: ResolvedPart | null = null;
  if (partNumber) part = await resolveByPartNumber(partNumber);
  if (!part && eee) part = await resolveByEee(eee);
  if (!part && serial) {
    if (scope.all) {
      const [rows] = await getDbPool().query('SELECT part_number FROM parts_units WHERE serial = ? LIMIT 1', [serial]);
      const found = (rows as Array<{ part_number: string }>)[0];
      if (found) part = await resolveByPartNumber(found.part_number);
    }
    if (!part) part = (await resolveBySerial(serial))?.part ?? null;
  }
  let unit: unknown = null;
  if (serial) {
    const [rows] = scope.all
      ? await getDbPool().query(`SELECT u.id, u.part_number, u.serial, u.quantity, u.status, u.reference, s.code AS site_code FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.serial = ? LIMIT 1`, [serial])
      : await getDbPool().query(`SELECT u.id, u.part_number, u.serial, u.quantity, u.status, u.reference, s.code AS site_code FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.serial = ? AND s.code = ? LIMIT 1`, [serial, scope.site!.code]);
    unit = (rows as Array<Record<string, unknown>>)[0] ?? null;
  }
  res.json({ part, unit });
});

router.get('/lookup', async (req, res) => {
  await ensurePartsTables();
  const serial = upper(req.query.serial);
  if (!serial) { bad(res, 'Serial number is required.'); return; }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const pool = getDbPool();
  const [unitRows] = scope.all
    ? await pool.query(`SELECT u.id, u.part_number, u.serial, u.quantity, u.status, u.reference, u.occurred_date, s.code AS site_code, s.name AS site_name FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.serial = ? LIMIT 1`, [serial])
    : await pool.query(`SELECT u.id, u.part_number, u.serial, u.quantity, u.status, u.reference, u.occurred_date, s.code AS site_code, s.name AS site_name FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.serial = ? AND s.code = ? LIMIT 1`, [serial, scope.site!.code]);
  const unit = (unitRows as Array<Record<string, unknown>>)[0] ?? null;
  if (!unit) { res.json({ unit: null, history: [] }); return; }
  const [history] = scope.all
    ? await pool.query('SELECT id, type, occurred_date, reference, quantity, created_at FROM parts_movements WHERE serial = ? ORDER BY created_at DESC, id DESC LIMIT 20', [serial])
    : await pool.query(`SELECT m.id, m.type, m.occurred_date, m.reference, m.quantity, m.created_at FROM parts_movements m INNER JOIN parts_sites s ON s.id = m.site_id WHERE m.serial = ? AND s.code = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 20`, [serial, scope.site!.code]);
  res.json({ unit, history });
});

router.get('/stock/parts', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const code = scope.all ? 'ALL' : scope.site!.code;
  const [rows] = await getDbPool().query(
    `SELECT u.part_number, MAX(m.description) AS description, MAX(u.occurred_date) AS date, COUNT(*) AS serials
     FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id LEFT JOIN parts_master m ON m.part_number = u.part_number
     WHERE u.status = 'in' ${code !== 'ALL' ? 'AND s.code = ?' : ''} GROUP BY u.part_number ORDER BY u.part_number ASC`,
    code !== 'ALL' ? [code] : []
  );
  res.json({ parts: rows });
});

router.get('/stock', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const siteCode = scope.all ? 'ALL' : scope.site!.code;
  const q = value(req.query.q);
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  const safeLimit = Number.isInteger(limit) ? limit : 500;
  const pool = getDbPool();
  const terms = searchTerms(q);
  const filter = terms.length
    ? `AND ${terms.map(() => '(u.part_number LIKE ? OR u.serial LIKE ? OR m.description LIKE ?)').join(' AND ')}`
    : '';
  const params: unknown[] = [];
  let siteFilter = '';
  if (siteCode && siteCode !== 'ALL') { siteFilter = 'AND s.code = ?'; params.push(siteCode); }
  for (const term of terms) params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  const [rows] = await pool.query(
    `SELECT u.id, u.part_number, m.description, u.serial, u.quantity, u.status, u.reference, u.occurred_date, s.code AS site_code, s.name AS site_name
     FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id LEFT JOIN parts_master m ON m.part_number = u.part_number
     WHERE u.status = 'in' ${siteFilter} ${filter} ORDER BY s.code ASC, u.part_number ASC, u.serial ASC LIMIT ${safeLimit}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(u.quantity), 0) AS units FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.status = 'in' ${siteFilter}`,
    siteCode && siteCode !== 'ALL' ? [siteCode] : []
  );
  const [outRows] = await pool.query(
    `SELECT COUNT(*) AS out_total, COUNT(DISTINCT u.part_number) AS out_parts FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.status != 'in' ${siteFilter}`,
    siteCode && siteCode !== 'ALL' ? [siteCode] : []
  );
  const [partRows] = await pool.query(
    `SELECT COUNT(DISTINCT u.part_number) AS parts FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.status = 'in' ${siteFilter}`,
    siteCode && siteCode !== 'ALL' ? [siteCode] : []
  );
  const summary = (countRows as Array<Record<string, unknown>>)[0];
  summary.out_total = (outRows as Array<Record<string, unknown>>)[0]?.out_total ?? 0;
  summary.parts = (partRows as Array<Record<string, unknown>>)[0]?.parts ?? 0;
  res.json({ stock: rows, summary });
});

// All serials (IN and OUT) of one part at the scoped site — the workbench.
router.get('/part-units', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const partNumber = value(req.query.partNumber);
  if (!partNumber) { bad(res, 'Part number is required.'); return; }
  const code = scope.all ? 'ALL' : scope.site!.code;
  const [rows] = await getDbPool().query(
    `SELECT u.id, u.part_number, m.description, u.serial, u.quantity, u.status, u.reference, u.occurred_date, u.stocked_in_at, u.stocked_out_at, s.code AS site_code
     FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id LEFT JOIN parts_master m ON m.part_number = u.part_number
     WHERE u.part_number = ? ${code !== 'ALL' ? 'AND s.code = ?' : ''} ORDER BY u.serial ASC`,
    code !== 'ALL' ? [partNumber, code] : [partNumber]
  );
  res.json({ units: rows });
});

router.get('/recent', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const siteCode = scope.all ? 'ALL' : scope.site!.code;
  const params: unknown[] = [];
  if (siteCode && siteCode !== 'ALL') params.push(siteCode);
  const [rows] = await getDbPool().query(
    `SELECT m.id, m.type, m.part_number, m.serial, m.occurred_date, m.reference, m.quantity, m.created_at, s.code AS site_code
     FROM parts_movements m INNER JOIN parts_sites s ON s.id = m.site_id
     ${siteCode && siteCode !== 'ALL' ? 'WHERE s.code = ?' : ''} ORDER BY m.created_at DESC, m.id DESC LIMIT 10`,
    params
  );
  res.json({ history: rows });
});

// ---------- Stock IN / OUT ----------

router.post('/stock/in', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (scope.all) { bad(res, 'Choose a site for this operation.'); return; }
  const site = scope.site!;
  let partNumber = value(req.body?.partNumber);
  const serial = upper(req.body?.serial);
  const eee = upper(req.body?.eee);
  if (!partNumber && eee) partNumber = (await resolveByEee(eee))?.part_number || '';
  const quantity = req.body?.quantity === undefined ? 1 : Number(req.body?.quantity);
  const occurredDate = parseDate(req.body?.occurredDate);
  if (!partNumber && !serial) { bad(res, 'Scan a serial or enter a part number.'); return; }
  if (!occurredDate) { bad(res, 'Date must use YYYY-MM-DD format.'); return; }
  // Bulk path: one serial per line from the podium multiline box — sanitized
  // (uppercased, spaces stripped, deduped, capped) and applied inside a
  // single transaction with per-serial errors, mirroring the import endpoints.
  const serials = Array.isArray(req.body?.serials)
    ? [...new Set((req.body.serials as unknown[]).map((s) => String(s ?? '').toUpperCase().replace(/\s+/g, '')).filter(Boolean))].slice(0, 200)
    : [];
  if (serials.length > 1) {
    let imported = 0;
    const errors: Array<{ serial: string; error: string }> = [];
    try {
      const result = await withConnection(async (conn) => {
        for (const s of serials) {
          try {
            const r = await applyStockIn(conn, { site, partNumber, serial: s, quantity: 1, occurredDate, actorUserId: req.user!.userId });
            r.sheetRow.actor = req.user!.email;
            void appendSheetRow(req.user!.userId, r.sheetRow).then((ok) => { if (ok) void markSheetSynced(r.movementId); });
            imported++;
          } catch (error) {
            errors.push({ serial: s, error: error instanceof StockError ? error.message : 'Unable to stock in this serial.' });
          }
        }
        return { imported, errors };
      });
      if (result.imported === 0) { bad(res, result.errors[0]?.error || 'Unable to stock in these serials.'); return; }
      res.status(201).json({
        message: `${result.imported} × ${partNumber || 'part'} stocked in at ${site.code}${result.errors.length ? `, ${result.errors.length} need attention` : ''}.`,
        imported: result.imported,
        failed: result.errors.length,
        errors: result.errors,
      });
    } catch (error) { stockError(res, error); }
    return;
  }
  try {
    const result = await withConnection((conn) =>
      applyStockIn(conn, { site, partNumber, serial, quantity, occurredDate, actorUserId: req.user!.userId })
    );
    result.sheetRow.actor = req.user!.email;
    void appendSheetRow(req.user!.userId, result.sheetRow).then((ok) => { if (ok) void markSheetSynced(result.movementId); });
    res.status(201).json({ message: result.message });
  } catch (error) { stockError(res, error); }
});

router.post('/stock/out', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (scope.all) { bad(res, 'Choose a site for this operation.'); return; }
  const site = scope.site!;
  const serial = upper(req.body?.serial);
  const partNumber = value(req.body?.partNumber);
  const reference = value(req.body?.reference);
  const quantity = req.body?.quantity === undefined ? 1 : Number(req.body?.quantity);
  const occurredDate = parseDate(req.body?.occurredDate);
  if (!reference) { bad(res, 'Reference number is required for stock out.'); return; }
  if (!occurredDate) { bad(res, 'Date must use YYYY-MM-DD format.'); return; }
  try {
    const result = await withConnection((conn) =>
      applyStockOut(conn, { site, partNumber, serial, quantity, reference, occurredDate, actorUserId: req.user!.userId })
    );
    result.sheetRow.actor = req.user!.email;
    void appendSheetRow(req.user!.userId, result.sheetRow).then((ok) => { if (ok) void markSheetSynced(result.movementId); });
    res.json({ message: result.message });
  } catch (error) { stockError(res, error); }
});

// ---------- Bulk imports ----------

router.post('/import/in', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (scope.all) { bad(res, 'Choose a site for this operation.'); return; }
  const site = scope.site!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length || rows.length > 1000) { bad(res, 'Send 1 to 1000 rows per import.'); return; }
  let imported = 0;
  const errors: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const partNumber = value(rows[i]?.partNumber);
    const serial = upper(rows[i]?.serial);
    const occurredDate = parseDate(rows[i]?.date);
    if (!partNumber) { errors.push({ row: i + 1, error: 'Part number is missing.' }); continue; }
    if (!occurredDate) { errors.push({ row: i + 1, error: 'Date must use YYYY-MM-DD format.' }); continue; }
    try {
      const result = await withConnection((conn) =>
        applyStockIn(conn, { site, partNumber, serial, quantity: 1, occurredDate, actorUserId: req.user!.userId })
      );
      result.sheetRow.actor = req.user!.email;
      void appendSheetRow(req.user!.userId, result.sheetRow).then((ok) => { if (ok) void markSheetSynced(result.movementId); });
      imported++;
    } catch (error) {
      errors.push({ row: i + 1, error: error instanceof StockError ? error.message : 'Unable to import this row.' });
    }
  }
  res.json({ imported, failed: errors.length, errors });
});

router.post('/import/out', async (req, res) => {
  await ensurePartsTables();
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (scope.all) { bad(res, 'Choose a site for this operation.'); return; }
  const site = scope.site!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length || rows.length > 1000) { bad(res, 'Send 1 to 1000 rows per import.'); return; }
  let imported = 0;
  const errors: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const serial = upper(rows[i]?.serial);
    const reference = value(rows[i]?.reference);
    const partNumber = value(rows[i]?.partNumber);
    const occurredDate = parseDate(rows[i]?.date);
    if (!serial) { errors.push({ row: i + 1, error: 'Serial number is missing.' }); continue; }
    if (!reference) { errors.push({ row: i + 1, error: 'Reference number is required.' }); continue; }
    if (!occurredDate) { errors.push({ row: i + 1, error: 'Date must use YYYY-MM-DD format.' }); continue; }
    try {
      const result = await withConnection((conn) =>
        applyStockOut(conn, { site, partNumber, serial, quantity: 1, reference, occurredDate, actorUserId: req.user!.userId })
      );
      result.sheetRow.actor = req.user!.email;
      void appendSheetRow(req.user!.userId, result.sheetRow).then((ok) => { if (ok) void markSheetSynced(result.movementId); });
      imported++;
    } catch (error) {
      errors.push({ row: i + 1, error: error instanceof StockError ? error.message : 'Unable to import this row.' });
    }
  }
  res.json({ imported, failed: errors.length, errors });
});

// ---------- Google Sheet log ----------

router.get('/sheets/status', async (req, res) => {
  await ensurePartsTables();
  const connection = await connectionFor(req.user!.userId).catch(() => null);
  const cfg = await sheetConfig().catch(() => null);
  const [pending] = await getDbPool().query('SELECT COUNT(*) AS count FROM parts_movements WHERE sheet_synced = 0').catch(() => [[{ count: 0 }]] as any);
  res.json({
    connected: Boolean(connection),
    email: connection?.google_email || null,
    spreadsheetId: cfg?.spreadsheet_id || '',
    spreadsheetName: cfg?.spreadsheet_name || '',
    sheetName: cfg?.sheet_name || '',
    pendingSync: Number((pending as Array<{ count: number }>)[0]?.count || 0),
  });
});

router.get('/sheets/connect', requireAdmin, async (req, res) => {
  await ensurePartsTables();
  try {
    res.redirect(connectUrl(req.user!.userId));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/sheets/callback', async (req, res) => {
  await ensurePartsTables().catch(() => undefined);
  const userId = decodeState(String(req.query.state || ''));
  const code = String(req.query.code || '');
  if (!userId || !code) { res.redirect(`${frontendUrl()}/admin/parts?sheetError=1`); return; }
  try {
    const { refreshToken, email } = await exchangeCode(code);
    await saveConnection(userId, refreshToken, email);
    res.redirect(`${frontendUrl()}/admin/parts?sheetConnected=1`);
  } catch (error) {
    console.error('parts sheet connect error:', error);
    res.redirect(`${frontendUrl()}/admin/parts?sheetError=1`);
  }
});

router.delete('/sheets/disconnect', requireAdmin, async (req, res) => {
  await ensurePartsTables();
  await getDbPool().execute('DELETE FROM parts_sheet_connections WHERE user_id = ?', [req.user!.userId]);
  res.json({ message: 'Google Sheet disconnected.' });
});

router.get('/sheets/config', async (_req, res) => {
  await ensurePartsTables();
  res.json({ config: await sheetConfig() });
});

router.post('/sheets/config', requireAdmin, async (req, res) => {
  const spreadsheetId = value(req.body?.spreadsheetId);
  const spreadsheetName = value(req.body?.spreadsheetName);
  const sheetName = value(req.body?.sheetName);
  if (!spreadsheetId || !sheetName) { bad(res, 'Spreadsheet ID and sheet name are required.'); return; }
  await ensurePartsTables();
  await getDbPool().execute(
    'INSERT INTO parts_sheet_config (id, spreadsheet_id, spreadsheet_name, sheet_name, updated_by) VALUES (1, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE spreadsheet_id = VALUES(spreadsheet_id), spreadsheet_name = VALUES(spreadsheet_name), sheet_name = VALUES(sheet_name), updated_by = VALUES(updated_by)',
    [spreadsheetId, spreadsheetName, sheetName, req.user!.userId]
  );
  res.json({ message: 'Sheet log destination saved.' });
});

router.get('/sheets/list', requireAdmin, async (req, res) => {
  const spreadsheetId = value(req.query.spreadsheetId);
  if (!spreadsheetId) { bad(res, 'Spreadsheet ID is required.'); return; }
  await ensurePartsTables();
  try {
    res.json(await listSheets(spreadsheetId, req.user!.userId));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post('/sheets/retry', requireAdmin, async (req, res) => {
  await ensurePartsTables();
  const [rows] = await getDbPool().query(
    `SELECT m.id, s.code AS site_code, s.name AS site_name, m.type, DATE_FORMAT(m.occurred_date, '%Y-%m-%d') AS date,
            m.part_number, COALESCE(pm.description, '') AS description, COALESCE(m.serial, '') AS serial,
            COALESCE(m.reference, '') AS reference, m.quantity, COALESCE(u.email, '') AS actor
     FROM parts_movements m INNER JOIN parts_sites s ON s.id = m.site_id
     LEFT JOIN parts_master pm ON pm.part_number = m.part_number LEFT JOIN users u ON u.id = m.actor_user_id
     WHERE m.sheet_synced = 0 ORDER BY m.id ASC LIMIT 200`
  );
  const pending = rows as Array<{ id: number; site_code: string; site_name: string; type: 'IN' | 'OUT'; date: string; part_number: string; description: string; serial: string; reference: string; quantity: number; actor: string }>;
  let synced = 0;
  for (const row of pending) {
    const ok = await appendSheetRow(req.user!.userId, { siteCode: row.site_code, siteName: row.site_name, type: row.type, date: row.date, partNumber: row.part_number, description: row.description, serial: row.serial, reference: row.reference, quantity: row.quantity, actor: row.actor });
    if (ok) { await markSheetSynced(row.id); synced++; }
  }
  res.json({ synced, remaining: pending.length - synced });
});

export default router;
