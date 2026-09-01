import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, getDbPool } from '../db/index.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureFrontlineTables, FRONTLINE_OPTION_KEYS, type FrontlineOptionKey } from './store.js';

const router = Router();
router.use(authenticateToken);
let frontlineSyncRunning = false;
let lastFrontlineSyncAt = 0;
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets openid email';

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

router.get('/source', async (req, res) => {
  await ensureFrontlineTables();
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  const endorsementRole = ['Admin', 'CSO', 'PMG', 'ENGR'].includes(req.user!.roleName || '');
  if (!access && !endorsementRole) { res.status(403).json({ error: 'Frontline or Engineer Endorsements access required' }); return; }
  const [rows] = await getDbPool().query('SELECT id, spreadsheet_id, spreadsheet_name, selected_sheets, write_sheet_name, last_synced_at, last_sync_status, last_sync_error FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const source = (rows as Array<Record<string, unknown>>)[0];
  if (!source) { res.json(null); return; }
  if (req.user!.roleName === 'Admin') { res.json({ ...source, last_synced_at: isoTimestamp(source.last_synced_at), selected_sheets: JSON.parse(String(source.selected_sheets || '[]')) }); return; }
  res.json({ write_sheet_name: source.write_sheet_name || null });
});

router.use(requireFrontlineAccess);

function isFrontlineOptionKey(value: string): value is FrontlineOptionKey {
  return (FRONTLINE_OPTION_KEYS as readonly string[]).includes(value);
}

router.get('/options', async (_req, res) => {
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query('SELECT id, list_key, label, sort_order FROM frontline_option_lists WHERE active = 1 ORDER BY list_key, sort_order, label');
  const options: Record<FrontlineOptionKey, Array<{ id: number; label: string; sort_order: number }>> = {
    product_division: [],
    transaction_type: [],
    cso: [],
  };
  for (const row of rows as Array<{ id: number; list_key: string; label: string; sort_order: number }>) {
    if (isFrontlineOptionKey(row.list_key)) options[row.list_key].push({ id: row.id, label: row.label, sort_order: row.sort_order });
  }
  res.json(options);
});

router.post('/options', requireAdmin, async (req, res) => {
  const listKey = text(req.body?.listKey);
  const label = text(req.body?.label);
  if (!isFrontlineOptionKey(listKey)) { res.status(400).json({ error: 'A valid option list is required.' }); return; }
  if (!label || label.length > 255) { res.status(400).json({ error: 'Option text is required and must be 255 characters or fewer.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  try {
    const [sortRows] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM frontline_option_lists WHERE list_key = ?', [listKey]);
    const sortOrder = Number((sortRows as Array<{ next_order: number }>)[0]?.next_order || 0);
    const [result] = await pool.execute('INSERT INTO frontline_option_lists (list_key, label, sort_order, created_by, updated_by) VALUES (?, ?, ?, ?, ?)', [listKey, label, sortOrder, req.user!.userId, req.user!.userId]);
    const id = Number((result as { insertId?: number }).insertId);
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'frontline.option_added', resourceType: 'frontline_option_list', resourceId: String(id), metadata: { listKey, label } });
    res.status(201).json({ id, list_key: listKey, label, sort_order: sortOrder });
  } catch (error) {
    if (String((error as Error).message).toLowerCase().includes('duplicate')) { res.status(409).json({ error: 'That option already exists in this list.' }); return; }
    throw error;
  }
});

router.get('/entry-check', async (req, res) => {
  const ar = text(req.query.ar);
  const serial = text(req.query.serial);
  const transactionType = text(req.query.transactionType);
  const occurredDate = text(req.query.date);
  const issue = text(req.query.issue);
  if ((!ar && !serial) || !transactionType || !occurredDate) { res.status(400).json({ error: 'AR or Serial Number, transaction type, and date are required.' }); return; }
  await ensureFrontlineTables();
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  const identifiers: string[] = []; const args: string[] = [];
  if (ar && serial) { identifiers.push('(LOWER(TRIM(fr.ar_number)) = LOWER(TRIM(?)) AND LOWER(TRIM(fr.serial_number)) = LOWER(TRIM(?)))'); args.push(ar, serial); }
  else if (ar) { identifiers.push('LOWER(TRIM(fr.ar_number)) = LOWER(TRIM(?))'); args.push(ar); }
  else { identifiers.push('LOWER(TRIM(fr.serial_number)) = LOWER(TRIM(?))'); args.push(serial); }
  const where = [`${identifiers[0]}`, 'fr.transaction_type = ?', 'fr.occurred_date = ?', 'LOWER(TRIM(fr.issue)) = LOWER(TRIM(?))']; args.push(transactionType, occurredDate, issue);
  if (access?.scope === 'cso' && access.cso) { where.push('fr.cso = ?'); args.push(access.cso); }
  const [rows] = await getDbPool().query(`SELECT fr.id, fr.ar_number, fr.serial_number, fr.transaction_type, fr.occurred_date FROM frontline_records fr WHERE ${where.join(' AND ')} ORDER BY fr.id DESC LIMIT 5`, args);
  res.json({ duplicate: (rows as unknown[]).length > 0, matches: rows });
});

router.get('/lookup', async (req, res) => {
  const ar = text(req.query.ar); const serial = text(req.query.serial);
  if (!ar && !serial) { res.status(400).json({ error: 'AR or Serial Number is required.' }); return; }
  await ensureFrontlineTables();
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  const where: string[] = []; const args: string[] = [];
  if (ar) { where.push('LOWER(TRIM(fr.ar_number)) = LOWER(TRIM(?))'); args.push(ar); }
  if (serial) { where.push('LOWER(TRIM(fr.serial_number)) = LOWER(TRIM(?))'); args.push(serial); }
  if (access?.scope === 'cso' && access.cso) { where.push('fr.cso = ?'); args.push(access.cso); }
  const [rows] = await getDbPool().query(`SELECT fr.id, fr.source_sheet, fr.source_row, fr.occurred_date, fr.aht_minutes, fr.transaction_type, fr.product_division, fr.ar_number, fr.serial_number, fr.device_model, fr.cso, fr.issue FROM frontline_records fr WHERE ${where.join(' AND ')} ORDER BY fr.occurred_date DESC, fr.id DESC LIMIT 20`, args);
  res.json(rows);
});

router.get('/serial-history', async (req, res) => {
  const serial = text(req.query.serial);
  if (!serial) { res.status(400).json({ error: 'Serial Number is required.' }); return; }
  await ensureFrontlineTables();
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  const args: string[] = [serial];
  const where = ['LOWER(TRIM(fr.serial_number)) = LOWER(TRIM(?))'];
  if (access?.scope === 'cso' && access.cso) { where.push('fr.cso = ?'); args.push(access.cso); }
  const [rows] = await getDbPool().query(`SELECT fr.id, fr.source_sheet, fr.occurred_date, fr.ar_number, fr.serial_number, fr.device_model, fr.product_division, fr.cso, fr.transaction_type, fr.issue FROM frontline_records fr WHERE ${where.join(' AND ')} ORDER BY fr.occurred_date DESC, fr.id DESC LIMIT 20`, args);
  res.json(rows);
});

router.patch('/options/:id', requireAdmin, async (req, res) => {
  const label = text(req.body?.label);
  if (!label || label.length > 255) { res.status(400).json({ error: 'Option text is required and must be 255 characters or fewer.' }); return; }
  await ensureFrontlineTables();
  const [result] = await getDbPool().execute('UPDATE frontline_option_lists SET label = ?, updated_by = ? WHERE id = ? AND active = 1', [label, req.user!.userId, Number(req.params.id)]);
  if ((result as { affectedRows: number }).affectedRows === 0) { res.status(404).json({ error: 'Option not found.' }); return; }
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'frontline.option_updated', resourceType: 'frontline_option_list', resourceId: req.params.id, metadata: { label } });
  res.json({ message: 'Option updated.', id: Number(req.params.id), label });
});

async function approvedSheet(sheetName: string) {
  const [rows] = await getDbPool().query('SELECT id, spreadsheet_id, write_sheet_name, updated_by FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const source = (rows as Array<Record<string, unknown>>)[0];
  if (!source) throw new Error('Choose a Google Sheet source first.');
  const writeSheetName = text(source.write_sheet_name);
  if (!writeSheetName) throw new Error('Configure a separate website entry worksheet in Admin first.');
  if (writeSheetName !== sheetName) throw new Error('This worksheet is not approved for website entry.');
  if (!source.updated_by) throw new Error('The approved Google Sheet connection owner is missing.');
  const connection = await connectionFor(Number(source.updated_by));
  if (!connection) throw new Error('Reconnect the approved Google account with Sheets write access.');
  return { source, connection };
}

function entryFingerprint(headers: string[], values: string[]): string | null {
  const normalizedHeaders = headers.map(headerKey);
  const find = (...names: string[]) => normalizedHeaders.findIndex((header) => names.some((name) => header === name || header.startsWith(`${name} `)));
  const arIdx = find('a/r number', 'a r number', 'ar number', 'ar no', 'ar');
  const serialIdx = find('serial number', 'serial no', 'serial');
  const typeIdx = find('type of transaction');
  const dateIdx = find('date', 'date logged', 'date of transaction', 'occurred date');
  const issueIdx = find('issue / remarks', 'issue remarks', 'issue');
  const ar = arIdx >= 0 ? text(values[arIdx]).toLowerCase() : '';
  const serial = serialIdx >= 0 ? text(values[serialIdx]).toLowerCase() : '';
  if (!ar && !serial) return null;
  const identity = [ar, serial, typeIdx >= 0 ? text(values[typeIdx]).toLowerCase() : '', dateIdx >= 0 ? text(values[dateIdx]).toLowerCase() : '', issueIdx >= 0 ? text(values[issueIdx]).toLowerCase() : ''].join('|');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

async function storeWrittenEntry(sourceId: number, sheet: string, sourceRow: number, headers: string[], values: string[]) {
  const normalizedHeaders = headers.map(headerKey);
  const find = (...names: string[]) => normalizedHeaders.findIndex((header) => names.some((name) => header === name || header.startsWith(`${name} `)));
  const dateIdx = find('date', 'date logged', 'date of transaction', 'occurred date');
  const startIdx = find('start time'); const endIdx = find('end time');
  const typeIdx = find('type of transaction'); const divisionIdx = find('product division');
  const arIdx = find('a/r number', 'a r number', 'ar number', 'ar no', 'ar');
  const serialIdx = find('serial number', 'serial no', 'serial');
  const deviceIdx = find('device model', 'device/model', 'model', 'device', 'product name');
  const csoIdx = find('cso', 'name of cso'); const issueIdx = find('issue / remarks', 'issue remarks', 'issue');
  const ar = arIdx >= 0 ? text(values[arIdx]) : ''; const serial = serialIdx >= 0 ? text(values[serialIdx]) : '';
  if (!ar && !serial) return;
  const dateValue = dateIdx >= 0 ? parseDate(text(values[dateIdx])) : null;
  await getDbPool().execute(`INSERT INTO frontline_records (source_id, source_sheet, source_row, occurred_date, start_time, end_time, aht_minutes, transaction_type, product_division, ar_number, serial_number, device_model, cso, issue, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE occurred_date = VALUES(occurred_date), start_time = VALUES(start_time), end_time = VALUES(end_time), aht_minutes = VALUES(aht_minutes), transaction_type = VALUES(transaction_type), product_division = VALUES(product_division), ar_number = VALUES(ar_number), serial_number = VALUES(serial_number), device_model = VALUES(device_model), cso = VALUES(cso), issue = VALUES(issue), raw_json = VALUES(raw_json)`, [
    sourceId, sheet, sourceRow, dateValue, startIdx >= 0 ? text(values[startIdx]) : '', endIdx >= 0 ? text(values[endIdx]) : '', startIdx >= 0 && endIdx >= 0 ? parseMinutes(text(values[startIdx]), text(values[endIdx])) : null,
    typeIdx >= 0 ? text(values[typeIdx]) : '', divisionIdx >= 0 ? text(values[divisionIdx]) : '', ar, serial, deviceIdx >= 0 ? text(values[deviceIdx]) : '', csoIdx >= 0 ? text(values[csoIdx]) : '', issueIdx >= 0 ? text(values[issueIdx]) : '', JSON.stringify(values),
  ]);
}

router.get('/write-schema', async (req, res) => {
  const sheet = text(req.query.sheet);
  try {
    const { connection } = await approvedSheet(sheet); const token = await tokenFor(connection);
    const [sourceRows] = await getDbPool().query('SELECT spreadsheet_id FROM frontline_sources ORDER BY id DESC LIMIT 1');
    const spreadsheetId = String((sourceRows as Array<Record<string, unknown>>)[0]?.spreadsheet_id || '');
    const data = await google<{ values?: string[][] }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheet}!1:10`)}?majorDimension=ROWS`);
    const headers = (data.values || []).find((row) => row.some((value) => text(value)))?.map((value) => text(value)) || [];
    if (!headers.length || headers.some((header) => !header)) { res.status(409).json({ error: 'The website entry worksheet must contain a complete header row.' }); return; }
    res.json({ sheet, headers });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});

router.post('/write-entry', async (req, res) => {
  const sheet = text(req.body?.sheet); const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(text) : []; const values = Array.isArray(req.body?.values) ? req.body.values.map(text) : [];
  if (!sheet || !headers.length || headers.length !== values.length) { res.status(400).json({ error: 'Worksheet columns and values are required.' }); return; }
  try {
    const { source, connection } = await approvedSheet(sheet); const token = await tokenFor(connection); const sourceId = Number(source.id); const sourceSpreadsheetId = String(source.spreadsheet_id);
    const schema = await google<{ values?: string[][] }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sourceSpreadsheetId)}/values/${encodeURIComponent(`${sheet}!1:10`)}?majorDimension=ROWS`);
    const currentHeaders = (schema.values || []).find((row) => row.some((value) => text(value)))?.map((value) => text(value)) || [];
    if (currentHeaders.length !== headers.length || currentHeaders.some((header, index) => header !== headers[index])) { res.status(409).json({ error: 'Worksheet columns changed. Reload the form before submitting.' }); return; }
    const fingerprint = entryFingerprint(headers, values);
    const pool = getDbPool();
    let result;
    try { [result] = await pool.execute('INSERT INTO frontline_sheet_writes (source_id, sheet_name, headers_json, values_json, status, created_by, dedupe_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)', [sourceId, sheet, JSON.stringify(headers), JSON.stringify(values), 'pending', req.user!.userId, fingerprint]); }
    catch (error) { if (String((error as Error).message).toLowerCase().includes('duplicate')) { res.status(409).json({ error: 'This exact AR, Serial Number, transaction type, date, and issue was already submitted.' }); return; } throw error; }
    const writeId = Number((result as { insertId?: number }).insertId);
    let googleSaved = false;
    try {
      const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sourceSpreadsheetId)}/values/${encodeURIComponent(`${sheet}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`;
      const appendResult = await google<{ updates?: { updatedRange?: string } }>(token, endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ majorDimension: 'ROWS', values: [values] }) });
      googleSaved = true;
      const updatedRange = appendResult.updates?.updatedRange || '';
      const rowMatch = updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+\d+)?$/i);
      if (rowMatch) await storeWrittenEntry(sourceId, sheet, Number(rowMatch[1]), headers, values);
      await pool.execute('UPDATE frontline_sheet_writes SET status = ?, written_at = CURRENT_TIMESTAMP WHERE id = ?', ['written', writeId]);
      void writeAuditLog({ actorUserId: req.user!.userId, action: 'frontline.sheet_entry_written', resourceType: 'frontline_sheet_write', resourceId: String(writeId), metadata: { sheet, columnCount: headers.length } });
      res.status(201).json({ message: 'Entry added to the approved worksheet.' });
    } catch (error) {
      if (googleSaved) {
        await pool.execute('UPDATE frontline_sheet_writes SET status = ?, error_message = ? WHERE id = ?', ['written', `Local lookup indexing delayed: ${(error as Error).message}`.slice(0, 500), writeId]);
        res.status(201).json({ message: 'Entry added to the approved worksheet. Lookup indexing will complete on the next refresh.' });
      } else {
        await pool.execute('UPDATE frontline_sheet_writes SET status = ?, error_message = ?, dedupe_fingerprint = NULL WHERE id = ?', ['failed', (error as Error).message.slice(0, 500), writeId]);
        res.status(502).json({ error: 'The entry was not saved to Google Sheets. You can safely try again.' });
      }
    }
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});

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

router.post('/source', requireAdmin, async (req, res) => {
  const spreadsheetId = text(req.body?.spreadsheetId); const spreadsheetName = text(req.body?.spreadsheetName); const sheets = Array.isArray(req.body?.sheets) ? req.body.sheets.map(text).filter(Boolean) : [];
  const writeSheetName = text(req.body?.writeSheetName);
  if (!spreadsheetId || !spreadsheetName || sheets.length === 0 || !writeSheetName) { res.status(400).json({ error: 'Spreadsheet, source worksheets, and a separate website entry worksheet are required.' }); return; }
  if (sheets.includes(writeSheetName)) { res.status(400).json({ error: 'The website entry worksheet must be separate from source worksheets.' }); return; }
  await ensureFrontlineTables();
  await getDbPool().execute(`INSERT INTO frontline_sources (spreadsheet_id, spreadsheet_name, selected_sheets, write_sheet_name, updated_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE spreadsheet_name = VALUES(spreadsheet_name), selected_sheets = VALUES(selected_sheets), write_sheet_name = VALUES(write_sheet_name), updated_by = VALUES(updated_by)`, [spreadsheetId, spreadsheetName, JSON.stringify(sheets), writeSheetName, req.user!.userId]);
  res.json({ message: 'Frontline source saved' });
});

router.post('/sync', async (req, res) => {
  await ensureFrontlineTables();
  const [sourceRows] = await getDbPool().query('SELECT * FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const source = (sourceRows as Array<Record<string, unknown>>)[0];
  if (!source) { res.status(400).json({ error: 'Choose a Google Sheet source first' }); return; }
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  if (!access) { res.status(403).json({ error: 'Frontline Monitor access required' }); return; }
  if (frontlineSyncRunning || Date.now() - lastFrontlineSyncAt < 60_000) { res.json({ imported: 0, skipped: true }); return; }
  frontlineSyncRunning = true;
  const sourceId = Number(source.id);
  const connectionOwnerId = req.user!.roleName === 'Admin' ? req.user!.userId : Number(source.updated_by);
  const connection = await connectionFor(connectionOwnerId);
  if (!connection) { frontlineSyncRunning = false; res.status(400).json({ error: 'Connect Google Sheets first' }); return; }
  try {
    const token = await tokenFor(connection);
    const selectedSheets = JSON.parse(String(source.selected_sheets || '[]')) as string[];
    const writeSheet = text(source.write_sheet_name);
    const sheets = [...new Set([...selectedSheets, ...(writeSheet ? [writeSheet] : [])])];
    const pool = getDbPool();
    await pool.execute('UPDATE frontline_sources SET last_sync_status = ?, last_sync_error = NULL WHERE id = ?', ['syncing', sourceId]);
    const records: unknown[][] = [];
    for (const sheet of sheets) {
      const data = await google<{ values?: string[][] }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(source.spreadsheet_id))}/values/${encodeURIComponent(sheet)}?valueRenderOption=FORMATTED_VALUE`);
      const values = data.values || []; const headerIndex = values.slice(0, 20).findIndex((row) => {
        const headers = row.map(headerKey);
        const hasReportHeaders = headers.includes('start time') && headers.includes('type of transaction');
        const hasLookupHeaders = headers.some((header) => ['a/r number', 'a r number', 'ar number', 'ar no', 'ar', 'serial number', 'serial no', 'serial'].includes(header));
        return hasReportHeaders || hasLookupHeaders;
      });
      if (headerIndex < 0) continue;
      const headers = values[headerIndex].map(headerKey); let currentDate: string | null = null;
      const find = (...names: string[]) => headers.findIndex((header) => names.some((name) => header === name || header.startsWith(`${name} `)));
      const dateIdx = find('date', 'date logged', 'date of transaction', 'occurred date'); const fallbackDateIdxes = dateIdx >= 0 ? [dateIdx] : [0, 1, 5]; const period = sheetPeriod(sheet); const startIdx = find('start time'); const endIdx = find('end time'); const typeIdx = find('type of transaction'); const divisionIdx = find('product division'); const arIdx = find('a/r number', 'a r number', 'ar number', 'ar no', 'ar'); const serialIdx = find('serial number', 'serial no', 'serial'); const deviceIdx = find('device model', 'device/model', 'model', 'device', 'product name'); const csoIdx = find('cso', 'name of cso'); const issueIdx = find('issue / remarks', 'issue remarks', 'issue');
      const hasReportHeaders = startIdx >= 0 && typeIdx >= 0;
      for (let i = headerIndex + 1; i < values.length; i++) {
        const row = values[i] || []; const type = text(row[typeIdx]); const cso = text(row[csoIdx]);
        const dateCandidates = fallbackDateIdxes.map((index) => parseDate(text(row[index]))).filter((value): value is string => !!value);
        const matchingSheetDate = dateCandidates.find((value) => matchesSheetPeriod(value, period));
        const explicitDate = dateCandidates[0] || null;
        if ((dateIdx < 0 || (!type && !cso)) && (matchingSheetDate || explicitDate)) currentDate = matchingSheetDate || explicitDate;
        const ar = arIdx >= 0 ? text(row[arIdx]) : ''; const serial = serialIdx >= 0 ? text(row[serialIdx]) : '';
        if (!type && !cso && (!ar && !serial || hasReportHeaders)) continue;
        const raw = JSON.stringify(row); const sourceRow = i + 1; const aht = startIdx >= 0 && endIdx >= 0 ? parseMinutes(text(row[startIdx]), text(row[endIdx])) : null;
        records.push([sourceId, sheet, sourceRow, currentDate, startIdx >= 0 ? text(row[startIdx]) : '', endIdx >= 0 ? text(row[endIdx]) : '', aht, type, divisionIdx >= 0 ? text(row[divisionIdx]) : '', ar, serial, deviceIdx >= 0 ? text(row[deviceIdx]) : '', cso, issueIdx >= 0 ? text(row[issueIdx]) : '', raw]);
      }
    }
    const writeConnection = await pool.getConnection();
    try {
      await writeConnection.beginTransaction();
      const sheetPlaceholders = sheets.map(() => '?').join(', ');
      await writeConnection.execute(`DELETE FROM frontline_records WHERE source_id = ? AND source_sheet IN (${sheetPlaceholders})`, [sourceId, ...sheets]);
      const insertSql = `INSERT INTO frontline_records (source_id, source_sheet, source_row, occurred_date, start_time, end_time, aht_minutes, transaction_type, product_division, ar_number, serial_number, device_model, cso, issue, raw_json) VALUES ${Array.from({ length: 500 }, () => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')} ON DUPLICATE KEY UPDATE occurred_date = VALUES(occurred_date), start_time = VALUES(start_time), end_time = VALUES(end_time), aht_minutes = VALUES(aht_minutes), transaction_type = VALUES(transaction_type), product_division = VALUES(product_division), ar_number = VALUES(ar_number), serial_number = VALUES(serial_number), device_model = VALUES(device_model), cso = VALUES(cso), issue = VALUES(issue), raw_json = VALUES(raw_json)`;
      for (let i = 0; i < records.length; i += 500) {
        const batch = records.slice(i, i + 500);
        const sql = batch.length === 500 ? insertSql : `INSERT INTO frontline_records (source_id, source_sheet, source_row, occurred_date, start_time, end_time, aht_minutes, transaction_type, product_division, ar_number, serial_number, device_model, cso, issue, raw_json) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')} ON DUPLICATE KEY UPDATE occurred_date = VALUES(occurred_date), start_time = VALUES(start_time), end_time = VALUES(end_time), aht_minutes = VALUES(aht_minutes), transaction_type = VALUES(transaction_type), product_division = VALUES(product_division), ar_number = VALUES(ar_number), serial_number = VALUES(serial_number), device_model = VALUES(device_model), cso = VALUES(cso), issue = VALUES(issue), raw_json = VALUES(raw_json)`;
        await writeConnection.query(sql, batch.flat());
      }
      await writeConnection.commit();
    } catch (error) {
      try { await writeConnection.rollback(); } catch { /* The connection may already be closed; there is nothing left to roll back. */ }
      throw error;
    } finally {
      try { writeConnection.release(); } catch { /* Ignore cleanup errors from a dropped connection. */ }
    }
    await pool.execute('UPDATE frontline_sources SET last_synced_at = CURRENT_TIMESTAMP, last_sync_status = ?, last_sync_error = NULL WHERE id = ?', ['ok', sourceId]);
    lastFrontlineSyncAt = Date.now();
    frontlineSyncRunning = false;
    res.json({ imported: records.length });
  } catch (error) {
    frontlineSyncRunning = false;
    try { await getDbPool().execute('UPDATE frontline_sources SET last_sync_status = ?, last_sync_error = ? WHERE id = ?', ['error', (error as Error).message.slice(0, 500), sourceId]); } catch { /* Preserve the original sync error if the database is unavailable. */ }
    res.status(502).json({ error: (error as Error).message });
  }
});

router.get('/device-models', async (req, res) => {
  await ensureFrontlineTables();
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  if (!access) { res.status(403).json({ error: 'Frontline Monitor access required' }); return; }
  const [rows] = await getDbPool().query('SELECT model_name FROM frontline_device_models WHERE active = 1 ORDER BY model_name ASC');
  res.json((rows as Array<{ model_name: string }>).map((row) => row.model_name));
});

router.get('/report', async (req, res) => {
  await ensureFrontlineTables();
  const values = (value: unknown) => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
  const start = text(req.query.start); const end = text(req.query.end); const ar = text(req.query.ar); const csos = values(req.query.cso); const types = values(req.query.type); const divisions = values(req.query.division);
  const access = await frontlineAccessFor(req.user!.userId, req.user!.roleId, req.user!.roleName);
  if (!access) { res.status(403).json({ error: 'Frontline Monitor access required' }); return; }
  const where: string[] = []; const args: string[] = [];
  const addIn = (column: string, selected: string[]) => { if (selected.length) { where.push(`${column} IN (${selected.map(() => '?').join(',')})`); args.push(...selected); } };
  if (start) { where.push('fr.occurred_date >= ?'); args.push(start); } if (end) { where.push('fr.occurred_date <= ?'); args.push(end); } if (ar) { where.push('(LOWER(TRIM(COALESCE(fr.ar_number, \'\'))) LIKE LOWER(?) OR LOWER(TRIM(COALESCE(fr.serial_number, \'\'))) LIKE LOWER(?))'); args.push(`%${ar}%`, `%${ar}%`); } addIn('fr.cso', csos); addIn('fr.transaction_type', types); addIn('fr.product_division', divisions);
  if (access.scope === 'cso' && access.cso) { where.push('fr.cso = ?'); args.push(access.cso); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [sourceRows] = await getDbPool().query('SELECT write_sheet_name FROM frontline_sources ORDER BY id DESC LIMIT 1');
  const writeSheet = text((sourceRows as Array<{ write_sheet_name?: unknown }>)[0]?.write_sheet_name);
  const orderBy = writeSheet
    ? 'ORDER BY fr.occurred_date DESC, CASE WHEN fr.source_sheet = ? THEN 1 ELSE 0 END ASC, fr.id DESC'
    : 'ORDER BY fr.occurred_date DESC, fr.id DESC';
  const queryArgs = writeSheet ? [...args, writeSheet] : args;
  const pool = getDbPool(); const [rows] = await pool.query(`SELECT fr.id, fr.source_sheet, fr.source_row, fr.occurred_date, fr.aht_minutes, fr.transaction_type, fr.product_division, fr.ar_number, fr.serial_number, fr.device_model, fr.cso, fr.issue, ee.id AS endorsement_id, ee.status AS endorsement_status, ee.engineer_name AS endorsed_engineer_name, ee.created_at AS endorsed_at FROM frontline_records fr LEFT JOIN engineer_endorsements ee ON ee.frontline_record_id = fr.id OR (ee.frontline_record_id IS NULL AND ee.ar_number = fr.ar_number) ${clause} ${orderBy} LIMIT 10000`, queryArgs);
  const records = rows as Array<Record<string, unknown>>; const aht = records.map((row) => Number(row.aht_minutes)).filter(Number.isFinite);
  const countBy = (key: string) => Object.entries(records.reduce<Record<string, number>>((acc, row) => { const value = String(row[key] || 'Unspecified'); acc[value] = (acc[value] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  res.json({ total: records.length, averageAht: aht.length ? Math.round(aht.reduce((sum, value) => sum + value, 0) / aht.length * 100) / 100 : 0, csos: countBy('cso'), types: countBy('transaction_type'), divisions: countBy('product_division'), records });
});

export default router;
