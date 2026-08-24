import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, getDbPool } from '../db/index.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureFrontlineTables } from './store.js';

const router = Router();
router.use(authenticateToken);
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly openid email';

function config() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'JWT_SECRET'] as const;
  for (const key of required) if (!process.env[key]) throw new Error(`${key} is not configured`);
  const defaultRedirectUri = process.env.NODE_ENV === 'production'
    ? 'https://tools.mspi.io/api/frontline/google/callback'
    : 'http://localhost:3001/api/frontline/google/callback';
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_SHEETS_REDIRECT_URI || defaultRedirectUri,
    key: crypto.createHash('sha256').update(process.env.JWT_SECRET!).digest(),
  };
}

function encodeState(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeState(value: string): number | null {
  try {
    const [payload, signature] = value.split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: number; exp?: number };
    return Number.isInteger(data.userId) && Number(data.exp) > Date.now() ? data.userId! : null;
  } catch { return null; }
}

function encrypt(value: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

function decrypt(value: string, key: Buffer): string {
  const [iv, tag, body] = value.split('.');
  if (!iv || !tag || !body) throw new Error('Malformed Google connection');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

async function google<T>(token: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options?.headers || {}) } });
  const data = await response.json() as T & { error?: { message?: string } | string; error_description?: string };
  if (!response.ok) {
    const error = typeof data.error === 'string' ? data.error : data.error?.message || data.error_description;
    throw new Error(`Google API request failed (${response.status}): ${error || 'unknown Google API error'}`);
  }
  return data;
}

async function tokenFor(connection: { refresh_token_encrypted: string }) {
  const c = config();
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: decrypt(connection.refresh_token_encrypted, c.key), grant_type: 'refresh_token' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Google authorization expired');
  return data.access_token;
}

function frontendUrl() { return process.env.FRONTEND_URL || 'http://localhost:5173'; }
function text(value: unknown) { return String(value ?? '').trim(); }
function isoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value).trim();
  if (!raw) return null;
  if (/\dT\d/.test(raw) || /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw.replace(' ', 'T')}Z`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
type FrontlineAccess = { scope: 'all' | 'cso'; cso: string | null } | null;
async function frontlineAccessFor(userId: number, roleId: number | null, roleName: string | null): Promise<FrontlineAccess> {
  if (roleName === 'Admin') return { scope: 'all', cso: null };
  const pool = getDbPool();
  const [grantRows] = await pool.query('SELECT access_scope, cso_name FROM frontline_user_access WHERE user_id = ? LIMIT 1', [userId]);
  const grant = (grantRows as Array<{ access_scope: string; cso_name: string | null }>)[0];
  if (grant?.access_scope === 'all') return { scope: 'all', cso: null };
  if (grant?.access_scope === 'cso' && grant.cso_name) return { scope: 'cso', cso: grant.cso_name };
  return null;
}
async function requireFrontlineAccess(req: Request, res: Response, next: () => void) {
  try {
    if (await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName)) { next(); return; }
    res.status(403).json({ error: 'Frontline Monitor access required' });
  } catch (error) {
    console.error('frontline access check error:', error);
    res.status(500).json({ error: 'Unable to verify Frontline Monitor access' });
  }
}
function headerKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function sheetPeriod(sheet: string) {
  const title = sheet.toLowerCase();
  const month = MONTHS.findIndex((name) => title.includes(name));
  const year = title.match(/20\d{2}/)?.[0];
  return month >= 0 && year ? { month, year: Number(year) } : null;
}

function matchesSheetPeriod(value: string, period: ReturnType<typeof sheetPeriod>) {
  if (!period) return false;
  const [year, month] = value.split('-').map(Number);
  return year === period.year && month === period.month + 1;
}

function parseDate(value: string): string | null {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }
  const named = value.match(/^(?:(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2}),?)\s+(\d{4})$/);
  if (named) {
    const day = Number(named[1] || named[4]);
    const monthName = (named[2] || named[3]).toLowerCase();
    const month = MONTHS.findIndex((name) => name.startsWith(monthName));
    if (month >= 0 && day >= 1 && day <= 31) return `${named[5]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (serial > 20000 && serial < 100000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return date.toISOString().slice(0, 10);
    }
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseMinutes(start: string, end: string): number | null {
  const parse = (value: string) => {
    const match = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return null;
    let hour = Number(match[1]);
    if (match[4]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (match[4]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return hour * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
  };
  const a = parse(start); const b = parse(end);
  if (a === null || b === null) return null;
  const diff = b >= a ? b - a : b + 24 * 60 - a;
  return Math.round(diff * 100) / 100;
}

router.get('/google/connect', requireAdmin, (_req: Request, res: Response) => {
  const c = config();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: SHEETS_SCOPE, state: encodeState(_req.user!.userId) }).toString();
  res.redirect(url.toString());
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const userId = decodeState(text(req.query.state));
  const code = text(req.query.code);
  if (!userId || !code) { res.redirect(`${frontendUrl()}/admin/frontline?error=Invalid Google authorization`); return; }
  try {
    const c = config();
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: 'authorization_code' }) });
    const tokens = await response.json() as { refresh_token?: string; error?: string };
    if (!response.ok || !tokens.refresh_token) throw new Error(tokens.error || 'Google did not return a refresh token');
    const token = await tokenFor({ refresh_token_encrypted: encrypt(tokens.refresh_token, c.key) });
    const profile = await google<{ email?: string }>(token, 'https://www.googleapis.com/oauth2/v3/userinfo');
    await ensureFrontlineTables();
    const pool = getDbPool();
    await pool.execute(`INSERT INTO frontline_google_connections (user_id, google_email, refresh_token_encrypted) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), refresh_token_encrypted = VALUES(refresh_token_encrypted)`, [userId, profile.email || 'Connected Google account', encrypt(tokens.refresh_token, c.key)]);
    void writeAuditLog({ actorUserId: userId, action: 'frontline.google_connected', resourceType: 'frontline_google_connection' });
    res.redirect(`${frontendUrl()}/admin/frontline?connected=1`);
  } catch (error) { res.redirect(`${frontendUrl()}/admin/frontline?error=${encodeURIComponent((error as Error).message)}`); }
});

router.get('/google/status', requireAdmin, async (_req, res) => {
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query('SELECT google_email FROM frontline_google_connections WHERE user_id = ? LIMIT 1', [_req.user!.userId]);
  const connection = (rows as Array<{ google_email: string }>)[0];
  res.json({ connected: !!connection, email: connection?.google_email || null });
});

router.delete('/google/disconnect', requireAdmin, async (req, res) => {
  await ensureFrontlineTables();
  await getDbPool().execute('DELETE FROM frontline_google_connections WHERE user_id = ?', [req.user!.userId]);
  res.json({ message: 'Google Sheets disconnected' });
});

async function connectionFor(userId: number) {
  const [rows] = await getDbPool().query('SELECT * FROM frontline_google_connections WHERE user_id = ? LIMIT 1', [userId]);
  return (rows as Array<{ refresh_token_encrypted: string }>)[0] || null;
}

router.get('/access', async (req, res) => {
  await ensureFrontlineTables();
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  const [rows] = await getDbPool().query('SELECT id, reason, status, created_at, reviewed_at FROM frontline_access_requests WHERE user_id = ? LIMIT 1', [req.user!.userId]);
  const request = (rows as Array<Record<string, unknown>>)[0];
  res.json({ allowed: !!access, scope: access?.scope || null, cso: access?.cso || null, request: request ? { ...request, created_at: isoTimestamp(request.created_at), reviewed_at: isoTimestamp(request.reviewed_at) } : null });
});

router.post('/access-request', async (req, res) => {
  const reason = text(req.body?.reason);
  if (reason.length > 1000) { res.status(400).json({ error: 'The reason must be 1000 characters or fewer.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  const allowed = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  if (allowed) { res.status(409).json({ error: 'You already have Frontline Monitor access.' }); return; }
  await pool.execute(`INSERT INTO frontline_access_requests (user_id, reason, status) VALUES (?, ?, 'pending') ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = 'pending', reviewed_by = NULL, reviewed_at = NULL`, [req.user!.userId, reason]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'frontline.access_requested', resourceType: 'frontline_access_request' });
  res.status(201).json({ message: 'Access request submitted.' });
});

router.use(requireFrontlineAccess);

router.get('/status', async (_req, res) => {
  await ensureFrontlineTables();
  const [connectionRows] = await getDbPool().query('SELECT id FROM frontline_google_connections LIMIT 1');
  const connectedRows = connectionRows as Array<{ id: number }>;
  const [sourceRows] = await getDbPool().query('SELECT id, spreadsheet_id, spreadsheet_name, last_synced_at, last_sync_status, last_sync_error FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const source = (sourceRows as Array<Record<string, unknown>>)[0];
  const sourceSpreadsheetId = source ? String(source.spreadsheet_id || '') : '';
  let sourceName: string | null = source?.spreadsheet_name ? String(source.spreadsheet_name) : null;
  if (source && sourceName === sourceSpreadsheetId && connectedRows.length > 0) {
    try {
      const [connections] = await getDbPool().query('SELECT refresh_token_encrypted FROM frontline_google_connections ORDER BY id ASC LIMIT 1');
      const connection = (connections as Array<{ refresh_token_encrypted: string }>)[0];
      const token = await tokenFor(connection);
      const metadata = await google<{ properties?: { title?: string } }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sourceSpreadsheetId)}?fields=properties.title`);
      if (metadata.properties?.title) {
        sourceName = metadata.properties.title;
        await getDbPool().execute('UPDATE frontline_sources SET spreadsheet_name = ? WHERE id = ?', [sourceName, Number(source.id)]);
      }
    } catch { /* Keep the saved ID when Google metadata is temporarily unavailable. */ }
  }
  res.json({
    connected: connectedRows.length > 0,
    sourceName,
    lastSyncedAt: isoTimestamp(source?.last_synced_at),
    syncStatus: source?.last_sync_status || 'never',
    syncError: source?.last_sync_error || null,
  });
});

router.get('/spreadsheets/:id/sheets', requireAdmin, async (req, res) => {
  const connection = await connectionFor(req.user!.userId);
  if (!connection) { res.status(400).json({ error: 'Connect Google Sheets first' }); return; }
  try {
    const token = await tokenFor(connection);
    const data = await google<{ properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(req.params.id)}?fields=properties.title,sheets.properties`);
    res.json({ title: data.properties?.title || req.params.id, sheets: (data.sheets || []).map((sheet) => sheet.properties).filter(Boolean) });
  } catch (error) { res.status(502).json({ error: (error as Error).message }); }
});

router.get('/source', requireAdmin, async (_req, res) => {
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query('SELECT id, spreadsheet_id, spreadsheet_name, selected_sheets, last_synced_at, last_sync_status, last_sync_error FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const source = (rows as Array<Record<string, unknown>>)[0];
  res.json(source ? { ...source, last_synced_at: isoTimestamp(source.last_synced_at), selected_sheets: JSON.parse(String(source.selected_sheets || '[]')) } : null);
});

router.post('/source', requireAdmin, async (req, res) => {
  const spreadsheetId = text(req.body?.spreadsheetId); const spreadsheetName = text(req.body?.spreadsheetName); const sheets = Array.isArray(req.body?.sheets) ? req.body.sheets.map(text).filter(Boolean) : [];
  if (!spreadsheetId || !spreadsheetName || sheets.length === 0) { res.status(400).json({ error: 'Spreadsheet and at least one worksheet are required' }); return; }
  await ensureFrontlineTables();
  await getDbPool().execute(`INSERT INTO frontline_sources (spreadsheet_id, spreadsheet_name, selected_sheets, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE spreadsheet_name = VALUES(spreadsheet_name), selected_sheets = VALUES(selected_sheets), updated_by = VALUES(updated_by)`, [spreadsheetId, spreadsheetName, JSON.stringify(sheets), req.user!.userId]);
  res.json({ message: 'Frontline source saved' });
});

router.post('/sync', requireAdmin, async (req, res) => {
  await ensureFrontlineTables();
  const [sourceRows] = await getDbPool().query('SELECT * FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const source = (sourceRows as Array<Record<string, unknown>>)[0];
  if (!source) { res.status(400).json({ error: 'Choose a Google Sheet source first' }); return; }
  const sourceId = Number(source.id);
  const connection = await connectionFor(req.user!.userId);
  if (!connection) { res.status(400).json({ error: 'Connect Google Sheets first' }); return; }
  try {
    const token = await tokenFor(connection); const sheets = JSON.parse(String(source.selected_sheets || '[]')) as string[]; const pool = getDbPool();
    await pool.execute('UPDATE frontline_sources SET last_sync_status = ?, last_sync_error = NULL WHERE id = ?', ['syncing', sourceId]);
    const records: unknown[][] = [];
    for (const sheet of sheets) {
      const data = await google<{ values?: string[][] }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(source.spreadsheet_id))}/values/${encodeURIComponent(sheet)}?valueRenderOption=FORMATTED_VALUE`);
      const values = data.values || []; const headerIndex = values.slice(0, 20).findIndex((row) => row.some((value) => headerKey(value) === 'start time') && row.some((value) => headerKey(value) === 'type of transaction'));
      if (headerIndex < 0) continue;
      const headers = values[headerIndex].map(headerKey); let currentDate: string | null = null;
      const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const dateIdx = find('date', 'date logged', 'date of transaction', 'occurred date'); const fallbackDateIdxes = dateIdx >= 0 ? [dateIdx] : [0, 1, 5]; const period = sheetPeriod(sheet); const startIdx = find('start time'); const endIdx = find('end time'); const typeIdx = find('type of transaction'); const divisionIdx = find('product division'); const arIdx = find('a/r number', 'a r number', 'ar number'); const serialIdx = find('serial number'); const deviceIdx = find('device model', 'device/model', 'model', 'device', 'product name', 'product'); const csoIdx = find('cso', 'name of cso'); const issueIdx = find('issue / remarks', 'issue remarks', 'issue');
      const hasDateMarkers = values.slice(headerIndex + 1).some((row) => {
        const type = text(row[typeIdx]); const cso = text(row[csoIdx]);
        return !type && !cso && fallbackDateIdxes.some((index) => !!parseDate(text(row[index])));
      });
      for (let i = headerIndex + 1; i < values.length; i++) {
        const row = values[i] || []; const type = text(row[typeIdx]); const cso = text(row[csoIdx]);
        const dateCandidates = fallbackDateIdxes.map((index) => parseDate(text(row[index]))).filter((value): value is string => !!value);
        const matchingSheetDate = dateCandidates.find((value) => matchesSheetPeriod(value, period));
        const explicitDate = dateCandidates[0] || null;
        if (!type && !cso && (matchingSheetDate || explicitDate)) currentDate = matchingSheetDate || explicitDate;
        else if (!hasDateMarkers && (matchingSheetDate || explicitDate)) currentDate = matchingSheetDate || explicitDate;
        if (!type && !cso) continue;
        const raw = JSON.stringify(row); const sourceRow = i + 1; const aht = startIdx >= 0 && endIdx >= 0 ? parseMinutes(text(row[startIdx]), text(row[endIdx])) : null;
        records.push([sourceId, sheet, sourceRow, currentDate, startIdx >= 0 ? text(row[startIdx]) : '', endIdx >= 0 ? text(row[endIdx]) : '', aht, type, divisionIdx >= 0 ? text(row[divisionIdx]) : '', arIdx >= 0 ? text(row[arIdx]) : '', serialIdx >= 0 ? text(row[serialIdx]) : '', deviceIdx >= 0 ? text(row[deviceIdx]) : '', cso, issueIdx >= 0 ? text(row[issueIdx]) : '', raw]);
      }
    }
    const writeConnection = await pool.getConnection();
    try {
      await writeConnection.beginTransaction();
      const insertSql = `INSERT INTO frontline_records (source_id, source_sheet, source_row, occurred_date, start_time, end_time, aht_minutes, transaction_type, product_division, ar_number, serial_number, device_model, cso, issue, raw_json) VALUES ${Array.from({ length: 500 }, () => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')} ON DUPLICATE KEY UPDATE occurred_date = VALUES(occurred_date), start_time = VALUES(start_time), end_time = VALUES(end_time), aht_minutes = VALUES(aht_minutes), transaction_type = VALUES(transaction_type), product_division = VALUES(product_division), ar_number = VALUES(ar_number), serial_number = VALUES(serial_number), device_model = VALUES(device_model), cso = VALUES(cso), issue = VALUES(issue), raw_json = VALUES(raw_json)`;
      for (let i = 0; i < records.length; i += 500) {
        const batch = records.slice(i, i + 500);
        const sql = batch.length === 500 ? insertSql : `INSERT INTO frontline_records (source_id, source_sheet, source_row, occurred_date, start_time, end_time, aht_minutes, transaction_type, product_division, ar_number, serial_number, device_model, cso, issue, raw_json) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')} ON DUPLICATE KEY UPDATE occurred_date = VALUES(occurred_date), start_time = VALUES(start_time), end_time = VALUES(end_time), aht_minutes = VALUES(aht_minutes), transaction_type = VALUES(transaction_type), product_division = VALUES(product_division), ar_number = VALUES(ar_number), serial_number = VALUES(serial_number), device_model = VALUES(device_model), cso = VALUES(cso), issue = VALUES(issue), raw_json = VALUES(raw_json)`;
        await writeConnection.query(sql, batch.flat());
      }
      await writeConnection.commit();
    } catch (error) {
      await writeConnection.rollback();
      throw error;
    } finally {
      writeConnection.release();
    }
    await pool.execute('UPDATE frontline_sources SET last_synced_at = CURRENT_TIMESTAMP, last_sync_status = ?, last_sync_error = NULL WHERE id = ?', ['ok', sourceId]);
    res.json({ imported: records.length });
  } catch (error) {
    await getDbPool().execute('UPDATE frontline_sources SET last_sync_status = ?, last_sync_error = ? WHERE id = ?', ['error', (error as Error).message.slice(0, 500), sourceId]);
    res.status(502).json({ error: (error as Error).message });
  }
});

router.get('/report', async (req, res) => {
  await ensureFrontlineTables();
  const values = (value: unknown) => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
  const start = text(req.query.start); const end = text(req.query.end); const ar = text(req.query.ar); const csos = values(req.query.cso); const types = values(req.query.type); const divisions = values(req.query.division);
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  if (!access) { res.status(403).json({ error: 'Frontline Monitor access required' }); return; }
  const where: string[] = []; const args: string[] = [];
  const addIn = (column: string, selected: string[]) => { if (selected.length) { where.push(`${column} IN (${selected.map(() => '?').join(',')})`); args.push(...selected); } };
  if (start) { where.push('occurred_date >= ?'); args.push(start); } if (end) { where.push('occurred_date <= ?'); args.push(end); } if (ar) { where.push('ar_number LIKE ?'); args.push(`%${ar}%`); } addIn('cso', csos); addIn('transaction_type', types); addIn('product_division', divisions);
  if (access.scope === 'cso' && access.cso) { where.push('cso = ?'); args.push(access.cso); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getDbPool(); const [rows] = await pool.query(`SELECT id, source_sheet, source_row, occurred_date, aht_minutes, transaction_type, product_division, ar_number, serial_number, device_model, cso, issue FROM frontline_records ${clause} ORDER BY occurred_date DESC, id DESC LIMIT 10000`, args);
  const records = rows as Array<Record<string, unknown>>; const aht = records.map((row) => Number(row.aht_minutes)).filter(Number.isFinite);
  const countBy = (key: string) => Object.entries(records.reduce<Record<string, number>>((acc, row) => { const value = String(row[key] || 'Unspecified'); acc[value] = (acc[value] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  res.json({ total: records.length, averageAht: aht.length ? Math.round(aht.reduce((sum, value) => sum + value, 0) / aht.length * 100) / 100 : 0, csos: countBy('cso'), types: countBy('transaction_type'), divisions: countBy('product_division'), records });
});

export default router;
