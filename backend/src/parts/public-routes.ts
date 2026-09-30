import { Router } from 'express';
import crypto from 'crypto';
import { getDbPool } from '../db/index.js';
import { ensurePartsTables } from './store.js';
import { resolveByEee, resolveByPartNumber, resolveBySerial, type ResolvedPart } from './eee.js';

const router = Router();

function value(input: unknown) { return String(input ?? '').trim(); }
function upper(input: unknown) { return value(input).toUpperCase(); }
function bad(res: any, message: string, code = 400) { res.status(code).json({ error: message }); }

interface Site { id: number; code: string; name: string; active: number }

async function getSite(code: unknown) {
  const [rows] = await getDbPool().query('SELECT id, code, name, active FROM parts_sites WHERE code = ? LIMIT 1', [upper(code)]);
  const site = (rows as Site[])[0];
  if (!site || !site.active) return null;
  return site;
}

/** Public site token — no userId, scoped to site only. Valid for 24h. */
function signPublicSiteToken(site: Site): string {
  const payload = Buffer.from(JSON.stringify({ siteId: site.id, code: site.code, exp: Date.now() + 24 * 60 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyPublicSiteToken(token: unknown): { id: number; code: string } | null {
  try {
    const [payload, signature] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { siteId?: number; code?: string; exp?: number };
    if (!data.siteId || !data.code || !(data.exp! > Date.now())) return null;
    return { id: data.siteId, code: data.code };
  } catch { return null; }
}

function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
}

// ---------- Verify site (no auth required) ----------

router.get('/sites/verify', async (req, res) => {
  await ensurePartsTables();
  const code = value(req.query.code);
  if (!code) { bad(res, 'Site code is required.'); return; }
  const site = await getSite(code);
  if (!site) { bad(res, 'Site code not found. Check the code and try again.', 404); return; }
  res.json({ site, siteToken: signPublicSiteToken(site) });
});

// ---------- Read-only endpoints (site token required) ----------

/** Middleware: require a valid public site token. */
function requireSiteToken(req: any, res: any, next: any) {
  const token = req.headers['x-site-token'];
  if (!token) { bad(res, 'Site token required. Verify a site code first.', 401); return; }
  const pinned = verifyPublicSiteToken(token);
  if (!pinned) { bad(res, 'Invalid or expired site token. Verify the site code again.', 401); return; }
  req.pinnedSite = pinned;
  next();
}

router.get('/stock', requireSiteToken, async (req: any, res) => {
  await ensurePartsTables();
  const siteCode = req.pinnedSite.code;
  const q = value(req.query.q);
  const includeOut = value(req.query.includeOut) === '1';
  const limit = Math.min(Math.max(Number(req.query.limit) || (includeOut ? 12000 : 500), 1), 12000);
  const safeLimit = Number.isInteger(limit) ? limit : (includeOut ? 12000 : 500);
  const pool = getDbPool();
  const terms = searchTerms(q);
  const filter = terms.length
    ? `AND ${terms.map(() => '(u.part_number LIKE ? OR u.serial LIKE ? OR m.description LIKE ?)').join(' AND ')}`
    : '';
  const params: unknown[] = [siteCode];
  for (const term of terms) params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  const [rows] = await pool.query(
    `SELECT u.id, u.part_number, m.description, u.serial, u.quantity, u.status, u.reference, u.location, u.occurred_date, u.stocked_out_at, s.code AS site_code, s.name AS site_name
     FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id LEFT JOIN parts_master m ON m.part_number = u.part_number
     WHERE ${includeOut ? '1 = 1' : "u.status = 'in'"} AND s.code = ? ${filter} ORDER BY u.part_number ASC, u.serial ASC LIMIT ${safeLimit}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(u.quantity), 0) AS units FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.status = 'in' AND s.code = ?`,
    [siteCode]
  );
  const [outRows] = await pool.query(
    `SELECT COUNT(*) AS out_total, COUNT(DISTINCT u.part_number) AS out_parts FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.status != 'in' AND s.code = ?`,
    [siteCode]
  );
  const [partRows] = await pool.query(
    `SELECT COUNT(DISTINCT u.part_number) AS parts FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.status = 'in' AND s.code = ?`,
    [siteCode]
  );
  const summary = (countRows as Array<Record<string, unknown>>)[0];
  summary.out_total = (outRows as Array<Record<string, unknown>>)[0]?.out_total ?? 0;
  summary.parts = (partRows as Array<Record<string, unknown>>)[0]?.parts ?? 0;
  res.json({ stock: rows, summary });
});

router.get('/part-units', requireSiteToken, async (req: any, res) => {
  await ensurePartsTables();
  const partNumber = value(req.query.partNumber);
  if (!partNumber) { bad(res, 'Part number is required.'); return; }
  const code = req.pinnedSite.code;
  const [rows] = await getDbPool().query(
    `SELECT u.id, u.part_number, m.description, u.serial, u.quantity, u.status, u.reference, u.location, u.occurred_date, u.stocked_in_at, u.stocked_out_at, s.code AS site_code
     FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id LEFT JOIN parts_master m ON m.part_number = u.part_number
     WHERE u.part_number = ? AND s.code = ? ORDER BY u.serial ASC`,
    [partNumber, code]
  );
  res.json({ units: rows });
});

router.get('/resolve', requireSiteToken, async (req: any, res) => {
  await ensurePartsTables();
  const serial = upper(req.query.serial); const partNumber = value(req.query.partNumber); const eee = upper(req.query.eee);
  const siteCode = req.pinnedSite.code;
  let part: ResolvedPart | null = null;
  if (partNumber) part = await resolveByPartNumber(partNumber);
  if (!part && eee) part = await resolveByEee(eee);
  if (!part && serial) part = (await resolveBySerial(serial))?.part ?? null;
  let unit: unknown = null;
  if (serial) {
    const [rows] = await getDbPool().query(
      `SELECT u.id, u.part_number, u.serial, u.quantity, u.status, u.reference, u.location, s.code AS site_code FROM parts_units u INNER JOIN parts_sites s ON s.id = u.site_id WHERE u.serial = ? AND s.code = ? LIMIT 1`,
      [serial, siteCode]
    );
    unit = (rows as Array<Record<string, unknown>>)[0] ?? null;
  }
  res.json({ part, unit });
});

router.get('/recent', requireSiteToken, async (req: any, res) => {
  await ensurePartsTables();
  const siteCode = req.pinnedSite.code;
  const [rows] = await getDbPool().query(
    `SELECT m.id, m.type, m.part_number, m.serial, m.occurred_date, m.reference, m.quantity, m.location, m.created_at, s.code AS site_code
     FROM parts_movements m INNER JOIN parts_sites s ON s.id = m.site_id
     WHERE s.code = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 10`,
    [siteCode]
  );
  res.json({ history: rows });
});

// ---------- Master search (no site token needed) ----------

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

export default router;
